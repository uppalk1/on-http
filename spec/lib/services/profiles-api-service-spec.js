// Copyright 2015-2016, EMC, Inc.

"use strict";

describe("Http.Services.Api.Profiles", function () {
    var profileApiService;
    var Errors;
    var Constants;
    var taskProtocol;
    var workflowApiService;
    var eventsProtocol;
    var waterline;
    var lookupService;

    before("Http.Services.Api.Profiles before", function() {
        helper.setupInjector([
            helper.di.simpleWrapper({}, 'TaskGraph.Store'),
            helper.di.simpleWrapper({}, 'TaskGraph.TaskGraph'),
            helper.require("/lib/services/workflow-api-service"),
            helper.require("/lib/services/profiles-api-service"),
            helper.require("/lib/services/swagger-api-service"),
            helper.require("/lib/api/view/view"),
            helper.require("/lib/services/schema-api-service")
        ]);
        profileApiService = helper.injector.get("Http.Services.Api.Profiles");
        Errors = helper.injector.get("Errors");
        Constants = helper.injector.get("Constants");
        waterline = helper.injector.get('Services.Waterline');
        waterline.nodes = {
            findByIdentifier: function() {}
        };
        waterline.lookups = {
            upsertProxyToMacAddress: function() {}
        };
        taskProtocol = helper.injector.get("Protocol.Task");
        workflowApiService = helper.injector.get("Http.Services.Api.Workflows");
        eventsProtocol = helper.injector.get("Protocol.Events");
        lookupService = helper.injector.get("Services.Lookup");
    });

    beforeEach("Http.Services.Api.Profiles beforeEach", function() {
        this.sandbox = sinon.sandbox.create();
    });

    afterEach("Http.Services.Api.Profiles afterEach", function() {
        this.sandbox.restore();
    });

    it("waitForDiscoveryStart should retry twice if task is not initially online", function() {
        this.sandbox.stub(taskProtocol, 'requestProperties');
        taskProtocol.requestProperties.onFirstCall().rejects(new Errors.RequestTimedOutError(""));
        taskProtocol.requestProperties.onSecondCall().rejects(new Errors.RequestTimedOutError(""));
        taskProtocol.requestProperties.onThirdCall().resolves();

        return profileApiService.waitForDiscoveryStart("testnodeid")
        .then(function() {
            expect(taskProtocol.requestProperties).to.have.been.calledThrice;
        });
    });

    describe("setLookup", function() {
        var proxy = '12.1.1.1';

        var res = {
            locals: {
                ipAddress: 'ip1'
            }
        };

        var profileReq = {
            query: {
                'ips': ['ip1', 'ip2'],
                'macs': ['mac1', 'mac2']
            },
            get: function(header) {
                if(header === Constants.HttpHeaders.ApiProxyIp) {
                    return proxy;
                }
            }
        };

        var profileReq1 = {
            query: {
                'ips': ['', ''],
                'macs': ['mac1', 'mac2']
            },
            get: function(header) {
                if(header === Constants.HttpHeaders.ApiProxyIp) {
                    return proxy;
                }
            }
        };

        it("setLookup should add IP lookup entry and proxy", function() {
            this.sandbox.stub(lookupService, 'setIpAddress').resolves();
            this.sandbox.stub(waterline.lookups, 'upsertProxyToMacAddress').resolves();
            return profileApiService.setLookup(profileReq, res)
            .then(function(result) {
                expect(lookupService.setIpAddress).to.be.calledWithExactly('ip1', 'mac1');
                expect(waterline.lookups.upsertProxyToMacAddress).to.be.calledOnce;
            });
        });

        it("setLookup does not lookup node on missing required query string", function() {
            this.sandbox.stub(lookupService, 'setIpAddress').resolves();
            this.sandbox.stub(waterline.lookups, 'upsertProxyToMacAddress').resolves();
            return profileApiService.setLookup({query: {macs:'macs'}}, res)
            .then(function(result) {
                expect(lookupService.setIpAddress).to.not.be.called;
                expect(waterline.lookups.upsertProxyToMacAddress).to.not.be.called;
            });
        });

        it("setLookup should set request IP and MAC lookup for query macs and ips", function() {
            this.sandbox.stub(lookupService, 'setIpAddress').resolves();

            return profileApiService.setLookup(profileReq, res)
            .then(function(result) {
                expect(lookupService.setIpAddress).to.be.calledWithExactly('ip1', 'mac1');
            });
        });

        it("setLookup should not set lookup if IP is null in query", function() {
            this.sandbox.stub(lookupService, 'setIpAddress').resolves();

            return profileApiService.setLookup(profileReq1, res)
            .then(function(result) {
                expect(lookupService.setIpAddress).to.not.be.called;
            });
        });

    });

    describe("getNode", function() {
        var node;

        before("getNode before", function() {
            node = {
                discovered: sinon.stub()
            };
        });

        beforeEach(function() {
            node.discovered.rejects(new Error('override in test'));
            node.discovered.reset();
        });

        it("getNode should create a new node and run discovery", function() {
            this.sandbox.stub(waterline.nodes, 'findByIdentifier').resolves(undefined);
            this.sandbox.stub(profileApiService, 'createNodeAndRunDiscovery').resolves();
            return profileApiService.getNode('testmac')
            .then(function() {
                expect(profileApiService.createNodeAndRunDiscovery)
                    .to.have.been.calledWith('testmac');
            });
        });

        it("getNode should run discovery for a pre-existing node with no catalogs", function() {
            var node = {
                discovered: sinon.stub().resolves(false),
                type: 'compute'
            };
            this.sandbox.stub(waterline.nodes, 'findByIdentifier').resolves(node);
            this.sandbox.stub(taskProtocol, 'activeTaskExists').rejects(new Error(''));
            this.sandbox.stub(profileApiService, 'runDiscovery').resolves();

            return profileApiService.getNode('testmac')
            .then(function() {
                expect(profileApiService.runDiscovery).to.have.been.calledWith(node);
            });
        });

        it("getNode should do nothing for a node with an active discovery workflow", function() {
            node.discovered.resolves(false);
            this.sandbox.stub(waterline.nodes, 'findByIdentifier').resolves(node);
            this.sandbox.stub(taskProtocol, 'activeTaskExists').resolves();
            this.sandbox.stub(profileApiService, 'runDiscovery').resolves();

            return expect(profileApiService.getNode('testmac')).to.become(node);
        });

        it("getNode should do nothing for a node with an active discovery workflow", function() {
            node.discovered.resolves(false);
            this.sandbox.stub(waterline.nodes, 'findByIdentifier').resolves(node);
            this.sandbox.stub(taskProtocol, 'activeTaskExists').resolves();
            this.sandbox.stub(profileApiService, 'runDiscovery').resolves();

            return expect(profileApiService.getNode('testmac')).to.become(node);
        });

        it("getNode should do nothing for a node that has already been discovered", function() {
            node.discovered.resolves(true);
            this.sandbox.stub(waterline.nodes, 'findByIdentifier').resolves(node);

            return expect(profileApiService.getNode('testmac')).to.become(node);
        });
    });

    it('should run discovery', function() {
        var node = { id: 'test', type: 'compute' };
        this.sandbox.stub(lookupService, 'nodeIdToProxy').resolves();
        this.sandbox.stub(workflowApiService, 'createAndRunGraph').resolves();
        this.sandbox.stub(profileApiService, 'waitForDiscoveryStart').resolves();
        return profileApiService.runDiscovery(node)
        .then(function(_node) {
            expect(_node).to.equal(node);
            expect(workflowApiService.createAndRunGraph).to.have.been.calledOnce;
            expect(workflowApiService.createAndRunGraph).to.have.been.calledWith({
                name: 'Graph.SKU.Discovery',
                options: {
                    defaults: {
                        graphOptions: {
                            target: node.id
                        },
                        nodeId: node.id
                    }
                }
            });
            expect(profileApiService.waitForDiscoveryStart).to.have.been.calledOnce;
            expect(profileApiService.waitForDiscoveryStart).to.have.been.calledWith(node.id);
        });
    });

    describe("renderProfile", function() {

        it("render profile fail when no active graph and invalid bootSettings", function() {
            var node = { id: 'test' , type: 'compute', bootSettings: {}};

            this.sandbox.stub(workflowApiService, 'findActiveGraphForTarget').resolves(undefined);
            this.sandbox.stub(taskProtocol, 'requestProperties').resolves();

            var promise = profileApiService.getProfileFromTaskOrNode(node);

            return expect(promise).to.be.rejectedWith('Unable to retrieve valid node bootSettings')
            .then(function() {
                expect(workflowApiService.findActiveGraphForTarget).to.have.been.calledOnce;
                expect(taskProtocol.requestProperties).to.not.be.called;
                expect(promise.reason().status).to.equal(500);
            });
        });

        it("render profile pass when no active graphs and node has bootSettings", function() {
            var node = {
                id: 'test',
                type: 'compute',
                bootSettings: {
                    profile: 'profile',
                    options: {}
                }
            };

            this.sandbox.stub(workflowApiService, 'findActiveGraphForTarget').resolves(undefined);
            this.sandbox.stub(taskProtocol, 'requestProperties').resolves();

            return profileApiService.getProfileFromTaskOrNode(node)
            .then(function(result) {
                expect(workflowApiService.findActiveGraphForTarget).to.have.been.calledOnce;
                expect(taskProtocol.requestProperties).to.not.be.called;
                expect(result).to.deep.equal(node.bootSettings);
            });
        });

        it("render profile pass when no active graph and bootSettings", function() {
            var node = { id: 'test', type: 'compute' };

            this.sandbox.stub(workflowApiService, 'findActiveGraphForTarget').resolves(undefined);
            this.sandbox.stub(taskProtocol, 'requestProperties').resolves();

            return profileApiService.getProfileFromTaskOrNode(node)
            .then(function(result) {
                expect(workflowApiService.findActiveGraphForTarget).to.have.been.calledOnce;
                expect(taskProtocol.requestProperties).to.not.be.called;
                expect(result).to.deep.equal({
                    context: undefined,
                    profile: 'ipxe-info.ipxe',
                    options: { message:
                        'No active workflow and bootSettings, continue to boot' }
                });

            });
        });

        it("render profile pass when having active graph and render succeed", function() {
            var node = { id: 'test', type: 'compute' };
            var graph = { context: {} };

            this.sandbox.stub(workflowApiService, 'findActiveGraphForTarget').resolves(graph);
            this.sandbox.stub(taskProtocol, 'requestProfile').resolves('profile');
            this.sandbox.stub(taskProtocol, 'requestProperties').resolves({});

            return profileApiService.getProfileFromTaskOrNode(node)
            .then(function(result) {
                expect(workflowApiService.findActiveGraphForTarget).to.have.been.calledOnce;
                expect(taskProtocol.requestProfile).to.have.been.calledOnce;
                expect(taskProtocol.requestProperties).to.have.been.calledOnce;
                expect(result).to.deep.equal({
                    context: graph.context,
                    profile: 'profile',
                    options: { kargs: null }
                });
            });
        });

        it("render profile fail when retrieve workflow properties fail", function() {
            var node = { id: 'test', type: 'compute' };

            this.sandbox.stub(workflowApiService, 'findActiveGraphForTarget').resolves(true);
            this.sandbox.stub(taskProtocol, 'requestProfile').resolves('profile');
            this.sandbox.stub(taskProtocol, 'requestProperties').rejects(new Error(''));

            var promise = profileApiService.getProfileFromTaskOrNode(node);

            return expect(promise).to.be.rejectedWith('Unable to retrieve workflow properties')
            .then(function() {
                expect(workflowApiService.findActiveGraphForTarget).to.have.been.calledOnce;
                expect(taskProtocol.requestProfile).to.have.been.calledOnce;
                expect(taskProtocol.requestProperties).to.have.been.calledOnce;
                expect(promise.reason().status).to.equal(503);
            });
        });

    });
});
