// Copyright 2016, EMC, Inc.

'use strict';

require('../../helper');

describe("UPnP Service", function() {
    var uPnPService;
    var systemUuid;
    var fs;
    var ejs = require('ejs');
    var SSDP = require('node-ssdp').Server;
    var SSDPClient = require('node-ssdp').Client;
    var EventEmitter = require('events').EventEmitter;
    var emitter = new EventEmitter();
    var udn = '<%= udn %>';
    var uuid = '66ddf9c7-a3a4-47fc-b603-60737d1f15a8';
    var sandbox = sinon.sandbox.create();
    var rx = {
        Observable: {
            interval: sandbox.stub().returns({
                subscribe: sandbox.spy(function(f1,f2) {
                    f1();
                    f2({error:'error'});
                    return {
                        dispose: sandbox.stub().resolves()
                    };
                })
            })
        }
    };
    var messenger = {
        start: sandbox.stub().returns(
            Promise.resolve()
        ),
        stop: sandbox.stub().returns(
            Promise.resolve()
        ),
        publish: sandbox.stub().returns(
            Promise.resolve()
        )
    };
    
    before(function() {
        helper.setupInjector([
            helper.require("/lib/services/upnp-service"),
            helper.di.simpleWrapper(messenger, 'Services.Messenger'),
            helper.di.simpleWrapper(rx,'Rx'),
            helper.di.requireWrapper('node-cache', 'node-cache')
        ]);
        helper.injector.get('Services.Configuration')
        .set('httpEndpoints', [{
            'port': 9999,
            'address': '1.2.3.4',
            'httpsEnabled': false,
            'routers': 'northbound-api-router'
            }]
        );
        
        uPnPService = helper.injector.get('Http.Services.uPnP');
        systemUuid = helper.injector.get('SystemUuid');
        fs = helper.injector.get('fs');
        
        sandbox.stub(fs, 'writeFileAsync');
        sandbox.stub(fs, 'readFileAsync');
        sandbox.stub(ejs, 'render');
        sandbox.stub(systemUuid, 'getUuid');
        sandbox.stub(SSDP.prototype, 'start').resolves();
        sandbox.stub(SSDP.prototype, 'stop').resolves();
        sandbox.stub(SSDP.prototype, 'addUSN').resolves();
        
        sandbox.stub(SSDPClient.prototype, 'start').resolves();
        sandbox.stub(SSDPClient.prototype, 'search').resolves();
        
        systemUuid.getUuid.resolves(uuid);
        fs.readFileAsync.resolves(udn);
        fs.writeFileAsync.resolves();
    });

    beforeEach(function() {
        sandbox.reset();
    });

    afterEach(function() {
        emitter.removeAllListeners('advertise-bye');
        emitter.removeAllListeners('advertise-alive');
        emitter.removeAllListeners('response');
        uPnPService.cache.removeAllListeners('set');
        uPnPService.cache.removeAllListeners('del');
        uPnPService.cache.removeAllListeners('expired');
    });

    helper.after(function () {
        sandbox.restore();
    });

    describe('service control', function() {
        
        it('should start service', function() {
            return uPnPService.start()
            .then(function() {
                expect(uPnPService.ssdpList.length).to.equal(uPnPService.registry.length);
            });
        });
        
        it('should stop service', function() {
            return expect(uPnPService.stop()).to.be.ok;
        });
        
        it('should find valid NT entry', function() {
            var nt = uPnPService.registry[0].urn;
            var urn = { nt: uPnPService.registry[0], index: 0 };
            return expect(uPnPService.findNTRegistry(nt)).to.deep.equal(urn);
        });
        
        it('should find no NT entries', function() {
            return expect(uPnPService.findNTRegistry('xyz')).to.deep.equal({});
        });
        
        it('should run advertise-alive event', function(done) {
            SSDP.prototype.on = function(event, callback) {
                emitter.on(event, function(header) {
                    callback.call(uPnPService, header);
                });
            };
            return uPnPService.start()
            .then(function() {
                expect(uPnPService.registry[0].alive).to.equal(false);
                emitter.emit('advertise-alive', {NT: uPnPService.registry[0].urn});
                setImmediate(function() {
                    try {
                        expect(uPnPService.registry[0].alive).to.equal(true);
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            });
        });
        
        it('should run advertise-bye event', function(done) {
            SSDP.prototype.on = function(event, callback) {
                emitter.on(event, function(header) {
                    callback.call(uPnPService, header);
                });
            };
            return uPnPService.start()
            .then(function() {
                uPnPService.registry[0].alive = true;
                emitter.emit('advertise-bye', {NT: uPnPService.registry[0].urn});
                setImmediate(function() {
                    try {
                        expect(uPnPService.registry[0].alive).to.equal(false);
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            });
        });

        it('should run client poller event', function(done) {
            SSDPClient.prototype.on = function(event, callback) {
                emitter.on(event, function(headers, code, info) {
                    callback.call(uPnPService, headers, code, info);
                });
            };
            return uPnPService.start()
            .then(function() {
                emitter.emit('response',
                             {
                                USN: 'usn-1234',
                                'CACHE-CONTROL':'max-age=1800'
                             },
                             {code:'200'},
                             {info:'info'});
                setImmediate(function() {
                    try {
                        expect(messenger.publish).to.have.been.calledOnce;
                        done();
                    } catch(e) {
                        done(e);
                    }
                });
            });
        });
    });
});

