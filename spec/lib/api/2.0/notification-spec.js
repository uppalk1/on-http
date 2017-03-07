// Copyright 2016, EMC, Inc.

'use strict';

describe('Http.Api.Notification', function () {
    var notificationApiService;

    var nodeNotificationMessage = {
        nodeId: '57a86b5c36ec578876878294',
        randomData: 'random data'
    };

    var broadcastNotificationMessage = {
        data: 'test data'
    };

    before('start HTTP server', function () {
        helper.setupInjector([
             helper.require("/lib/services/notification-api-service.js"),

        ]);
        this.timeout(5000);
        return helper.startServer([]).then(function () {
            notificationApiService = helper.injector.get('Http.Services.Api.Notification');
            sinon.stub(notificationApiService, 'postNodeNotification')
                .resolves(nodeNotificationMessage);
            sinon.stub(notificationApiService, 'postBroadcastNotification')
                .resolves(broadcastNotificationMessage);
        });

    });
    after('stop HTTP server', function () {
        function resetMocks(obj) {
            _(obj).methods().forEach(function (method) {
                if (typeof obj[method].restore === 'function') {
                    obj[method].restore();
                }
            }).value();
        }
        resetMocks(notificationApiService);
        return helper.stopServer();
    });

    describe('POST /notification', function () {
        it('should return node notification detail', function () {
            return helper.request()
            .post('/api/2.0/notification?nodeId=' +
                  nodeNotificationMessage.nodeId +
                  '&randomData=' +
                  nodeNotificationMessage.randomData)
            .set('Content-Type', 'application/json')
            .expect('Content-Type', /^application\/json/)
            .expect(201, nodeNotificationMessage)
            .then(function () {
                expect(notificationApiService.postNodeNotification).to.have.been.calledOnce;
                expect(notificationApiService.postNodeNotification)
                    .to.have.been.calledWith(nodeNotificationMessage);
            });
        });
        it('should return broadcast notification detail', function () {
            return helper.request()
            .post('/api/2.0/notification')
            .send(broadcastNotificationMessage)
            .set('Content-Type', 'application/json')
            .expect('Content-Type', /^application\/json/)
            .expect(201, broadcastNotificationMessage)
            .then(function () {
                expect(notificationApiService.postBroadcastNotification).to.have.been.calledOnce;
                expect(notificationApiService.postBroadcastNotification)
                    .to.have.been.calledWith(broadcastNotificationMessage);
            });
        });
        it('should pass with nodeId in query body', function () {
            return helper.request()
            .post('/api/2.0/notification')
            .send({ nodeId: nodeNotificationMessage.nodeId })
            .expect('Content-Type', /^application\/json/)
            .expect(201, nodeNotificationMessage);
        });

        it('should pass with nodeId in query body', function () {
            return helper.request()
            .post('/api/2.0/notification')
            .send(nodeNotificationMessage)
            .expect('Content-Type', /^application\/json/)
            .expect(201, nodeNotificationMessage);
        });
    });

    describe('POST /notification/progress', function () {
        beforeEach(function() {
            sinon.stub(notificationApiService, 'postNotification').resolves();
        });

        afterEach(function() {
            notificationApiService.postNotification.restore();
        });

        it('should post progress notification via body', function () {
            return helper.request()
            .post('/api/2.0/notification/progress')
            .set('Content-Type', 'application/json')
            .send({
                taskId: 'test',
                maximum: 5,
                value: 2,
                description: 'foo bar'
            })
            .expect(200)
            .expect(function(res){
                expect(res.text).to.equal('Notification response, no file will be sent');
            })
            .then(function() {
                expect(notificationApiService.postNotification).to.be.calledWith({
                    taskId: 'test',
                    progress: {
                        maximum: 5,
                        value: 2,
                        description: 'foo bar'
                    }
                });
            });
        });

        it('should post progress notification via query', function () {
            return helper.request()
            .post('/api/2.0/notification/progress?taskId=testid&maximum=5&value=2&description=foo%20bar%20%202') //jshint ignore: line
            .set('Content-Type', 'application/json')
            .expect(200)
            .expect(function(res){
                expect(res.text).to.equal('Notification response, no file will be sent');
            })
            .then(function() {
                expect(notificationApiService.postNotification).to.be.calledWith({
                    taskId: 'testid',
                    progress: {
                        maximum: 5,
                        value: 2,
                        description: 'foo bar  2'
                    }
                });
            });
        });

        it('should return 400 if taskId is missing in query', function() {
            return helper.request()
            .post('/api/2.0/notification/progress?maximum=5&value=2&description=foo')
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should return 400 if maximum is missing in query', function() {
            return helper.request()
            .post('/api/2.0/notification/progress?taskId=testid&value=2&description=foo')
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should return 400 if value is missing in query', function() {
            return helper.request()
            .post('/api/2.0/notification/progress?taskId=testid&maximum=4&description=foo')
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should be success if description is missing in query', function() {
            return helper.request()
            .post('/api/2.0/notification/progress?taskId=testid&maximum=4&value=2')
            .set('Content-Type', 'application/json')
            .expect(200);
        });

        it('should return 400 if taskId is missing in body', function() {
            return helper.request()
            .post('/api/2.0/notification/progress')
            .send({
                maximum: 5,
                value: 2,
                description: 'foo bar'
            })
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should return 400 if maximum is missing in body', function() {
            return helper.request()
            .post('/api/2.0/notification/progress')
            .send({
                taskId: 'test',
                value: 2,
                description: 'foo bar'
            })
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should return 400 if value is missing in body', function() {
            return helper.request()
            .post('/api/2.0/notification/progress')
            .send({
                taskId: 'test',
                maximum: 5,
                description: 'foo bar'
            })
            .set('Content-Type', 'application/json')
            .expect(400);
        });

        it('should be success if description is missing in body', function() {
            return helper.request()
            .post('/api/2.0/notification/progress')
            .send({
                taskId: 'test',
                maximum: 5,
                value: 2
            })
            .set('Content-Type', 'application/json')
            .expect(200);
        });
    });

    describe('GET /notification/progress', function () {
        beforeEach(function() {
            sinon.stub(notificationApiService, 'postNotification').resolves();
        });

        afterEach(function() {
            notificationApiService.postNotification.restore();
        });

        it('should update progress notification via query', function () {
            return helper.request()
            .get('/api/2.0/notification/progress?taskId=testid&maximum=5&value=2&description=foo%20bar%20%202') //jshint ignore: line
            .expect(200)
            .expect(function(res){
                expect(res.text).to.equal('Notification response, no file will be sent');
            })
            .then(function() {
                expect(notificationApiService.postNotification).to.be.calledWith({
                    taskId: 'testid',
                    progress: {
                        maximum: 5,
                        value: 2,
                        description: 'foo bar  2'
                    }
                });
            });
        });

        it('should return 400 if taskId is missing', function() {
            return helper.request()
            .get('/api/2.0/notification/progress?maximum=5&value=2&description=foo')
            .expect(400);
        });

        it('should return 400 if maximum is missing', function() {
            return helper.request()
            .get('/api/2.0/notification/progress?taskId=testid&value=2&description=foo')
            .expect(400);
        });

        it('should return 400 if value is missing', function() {
            return helper.request()
            .get('/api/2.0/notification/progress?taskId=testid&maximum=4&description=foo')
            .expect(400);
        });

        it('should be success if description is missing', function() {
            return helper.request()
            .get('/api/2.0/notification/progress?taskId=testid&maximum=4&value=2')
            .expect(200);
        });
    });
});
