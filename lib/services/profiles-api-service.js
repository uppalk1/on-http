// Copyright 2015-2016, EMC, Inc.

'use strict';

var di = require('di'),
    ejs = require('ejs');


module.exports = profileApiServiceFactory;
di.annotate(profileApiServiceFactory, new di.Provide('Http.Services.Api.Profiles'));
di.annotate(profileApiServiceFactory,
    new di.Inject(
        'Promise',
        'Http.Services.Api.Workflows',
        'Protocol.Task',
        'Protocol.Events',
        'Services.Waterline',
        'Services.Configuration',
        'Services.Lookup',
        'Logger',
        'Errors',
        '_',
        'Profiles',
        'Services.Environment',
        'Http.Services.Swagger',
        'Constants'
    )
);
function profileApiServiceFactory(
    Promise,
    workflowApiService,
    taskProtocol,
    eventsProtocol,
    waterline,
    configuration,
    lookupService,
    Logger,
    Errors,
    _,
    profiles,
    Env,
    swaggerService,
    Constants
) {

    var logger = Logger.initialize(profileApiServiceFactory);

    function ProfileApiService() {
    }

    // Helper to convert property kargs into an ipxe friendly string.
    ProfileApiService.prototype.convertProperties = function(properties) {
        properties = properties || {};

        if (properties.hasOwnProperty('kargs')) {
            // This a promotion of the kargs property
            // for DOS disks (or linux) for saving
            // the trouble of having to write a
            // bunch of code in the EJS template.
            if(typeof properties.kargs === 'object') {
                properties.kargs = _.map(
                    properties.kargs, function (value, key) {
                    return key + '=' + value;
                }).join(' ');
            }
        } else {
            // Ensure kargs is set for rendering.
            properties.kargs = null;
        }

        return properties;
    };

    ProfileApiService.prototype.getMacs = function(macs) {
        return _.flattenDeep([macs]);
    };

    ProfileApiService.prototype.setLookup = function(req, res) {
        var query = req.swagger ? req.swagger.query : req.query;

        if (!query.macs || !query.ips)
            return Promise.resolve();

        /* Select request's mac and ip, then set them*/
        var macAddresses = _.flattenDeep([query.macs]);
        var ipAddresses = _.flattenDeep([query.ips]);

        var index = _.findIndex(ipAddresses, function(ip) {
            return (ip && (ip === res.locals.ipAddress));
        });

        if (index < 0 || !macAddresses[index]) {
            return Promise.resolve();
        }

        return lookupService.setIpAddress(ipAddresses[index], macAddresses[index])
        .then(function() {
            if (req.get(Constants.HttpHeaders.ApiProxyIp)) {
                var proxy = 'http://%s:%s'.format(
                    req.get(Constants.HttpHeaders.ApiProxyIp),
                    req.get(Constants.HttpHeaders.ApiProxyPort)
                );
                return waterline.lookups.upsertProxyToMacAddress(proxy, macAddresses[index]);
            }
        });
    };

    ProfileApiService.prototype.getNode = function(macAddresses, options) {
        var self = this;
        return waterline.nodes.findByIdentifier(macAddresses)
        .then(function (node) {
            if (node) {
                return node.discovered()
                .then(function(discovered) {
                    if (!discovered) {
                        return taskProtocol.activeTaskExists(node.id)
                        .then(function() {
                            return node;
                        })
                        .catch(function() {
                            return self.runDiscovery(node, options);
                        });
                    } else {
                        // We only count a node as having been discovered if
                        // a node document exists AND it has any catalogs
                        // associated with it
                        return node;
                    }

                });
            } else {
                return self.createNodeAndRunDiscovery(macAddresses, options);
            }
        });
    };

    ProfileApiService.prototype.runDiscovery = function(node, options) {
        var self = this;
        var configuration;

        if (node.type === 'switch') {
            configuration = self.getSwitchDiscoveryConfiguration(node, options.switchVendor);
        } else {
            configuration = {
                name: 'Graph.SKU.Discovery',
                options: {
                    defaults: {
                        graphOptions: {
                            target: node.id
                        },
                        nodeId: node.id
                    }
                }
            };
        }

        // If there is an api proxy add it to the context
        lookupService.nodeIdToProxy(node.id).then( function(proxy) {
            if(proxy) {
                configuration.context = {proxy: proxy};
            }
        });

        // The nested workflow holds the lock against the nodeId in this case,
        // so don't add it as a target to the outer workflow context
        return workflowApiService.createAndRunGraph(configuration, null)
        .then(function() {
            return self.waitForDiscoveryStart(node.id);
        })
        .then(function() {
            return node;
        });
    };

    ProfileApiService.prototype.getSwitchDiscoveryConfiguration = function(node, vendor) {
        var configuration = {
            name: 'Graph.SKU.Switch.Discovery.Active',
            options: {
                defaults: {
                    graphOptions: {
                        target: node.id
                    },
                    nodeId: node.id
                },
                'vendor-discovery-graph': {
                    graphName: null
                }
            }
        };

        vendor = vendor.toLowerCase();

        if (vendor === 'cisco') {
            configuration.options['vendor-discovery-graph'].graphName =
                'Graph.Switch.Discovery.Cisco.Poap';
        } else if (vendor === 'brocade') {
            configuration.options['vendor-discovery-graph'].graphName =
                'Graph.Switch.Discovery.Brocade.Ztp';
        } else if (vendor === 'arista') {
            configuration.options['vendor-discovery-graph'].graphName =
                'Graph.Switch.Discovery.Arista.Ztp';
        } else {
            throw new Errors.BadRequestError('Unknown switch vendor ' + vendor);
        }

        return configuration;
    };

    ProfileApiService.prototype.createNodeAndRunDiscovery = function(macAddresses, options) {
        var self = this;
        var node;
        return Promise.resolve().then(function() {
            return waterline.nodes.create({
                name: macAddresses.join(','),
                identifiers: macAddresses,
                type: options.type
            });
        }).tap(function(_node) {
            return eventsProtocol.publishNodeEvent(_node, 'added');
        }).then(function (_node) {
            node = _node;

            return Promise.resolve(macAddresses).each(function (macAddress) {
                return waterline.lookups.upsertNodeToMacAddress(node.id, macAddress);
            });
        })
        .then(function () {
            // Setting newRecord to true allows us to
            // render the redirect again to avoid refresh
            // of the node document and race conditions with
            // the state machine changing states.
            node.newRecord = true;

            return self.runDiscovery(node, options);
        });
    };

    // Quick and dirty extra two retries for the discovery graph, as the
    // runTaskGraph promise gets resolved before the tasks themselves are
    // necessarily started up and subscribed to bus events.
    ProfileApiService.prototype.waitForDiscoveryStart = function(nodeId) {
        var retryRequestProperties = function(error) {
            if (error instanceof Errors.RequestTimedOutError) {
                return taskProtocol.requestProperties(nodeId);
            } else {
                throw error;
            }
        };

        return taskProtocol.requestProperties(nodeId)
        .catch(retryRequestProperties)
        .catch(retryRequestProperties);
    };

    ProfileApiService.prototype._handleProfileRenderError = function(errMsg, type, status) {
        var err = new Error("Error: " + errMsg);
        err.status = status || 500;
        throw err;
    };

    ProfileApiService.prototype.getProfileFromTaskOrNode = function(node) {
        var self = this;
        var defaultProfile;

        if (node.type === 'switch') {
            // Unlike for compute nodes, we don't need to or have the capability
            // of booting into a microkernel, so just send down the
            // python script right away, and start downloading
            // and executing tasks governed by the switch-specific
            // discovery workflow.
            defaultProfile = 'taskrunner.py';
        } else {
            defaultProfile = 'redirect.ipxe';
        }

        return workflowApiService.findActiveGraphForTarget(node.id)
        .then(function (taskgraphInstance) {
            if (taskgraphInstance) {
                return taskProtocol.requestProfile(node.id)
                .catch(function(err) {
                    if (node.type === 'switch') {
                        return null;
                    } else {
                        throw err;
                    }
                })
                .then(function(profile) {
                    return [profile, taskProtocol.requestProperties(node.id)];
                })
                .spread(function (profile, properties) {
                    var _options;
                    if (node.type === 'compute') {
                        _options = self.convertProperties(properties);
                    } else if (node.type === 'switch') {
                        _options = { identifier: node.id };
                    }
                    return {
                        profile: profile || defaultProfile,
                        options: _options,
                        context: taskgraphInstance.context
                    };
                })
                .catch(function (e) {
                    logger.warning("Unable to retrieve workflow properties", {
                        error: e,
                        id: node.id,
                        taskgraphInstance: taskgraphInstance
                    });
                    return self._handleProfileRenderError(
                        'Unable to retrieve workflow properties', node.type, 503);
                });
            } else {
                if (_.has(node, 'bootSettings')) {
                    if (_.has(node.bootSettings, 'options') &&
                            _.has(node.bootSettings, 'profile')) {
                        return {
                            profile: node.bootSettings.profile || 'redirect.ipxe',
                            options: node.bootSettings.options
                        };
                    } else {
                        return self._handleProfileRenderError(
                                'Unable to retrieve valid node bootSettings', node.type);
                    }
                } else {
                    return {
                        profile: 'ipxe-info.ipxe',
                        options: { message:
                            'No active workflow and bootSettings, continue to boot' },
                        context: undefined
                    };
                }
            }
        });
    };

    ProfileApiService.prototype.renderProfile = function (profile, req, res) {
        var scope = res.locals.scope;
        var options = profile.options || {};
        var graphContext = profile.context || {};

        var promises = [
            swaggerService.makeRenderableOptions(req, res, graphContext,
                    profile.ignoreLookup),
            profiles.get(profile.profile, true, scope)
        ];

        if (profile.profile.endsWith('.ipxe')) {
            promises.push(profiles.get('boilerplate.ipxe', true, scope));
        }

        return Promise.all(promises).spread(
            function (localOptions, contents, boilerPlate) {
                options = _.merge({}, options, localOptions);
                // Render the requested profile + options. Don't stringify undefined.
                return ejs.render((boilerPlate || '') + contents, options);
            }
        );
    };

    ProfileApiService.prototype.getProfiles = function(req, query, res) {
        var self = this;
        return this.setLookup(req, res)
            .then(function() {
                var macs = query.mac || query.macs;
                if (macs) {
                    var macAddresses = self.getMacs(macs);
                    var options = {
                        type: 'compute'
                    };

                    return self.getNode(macAddresses, options)
                        .then(function (node) {
                            return self.getProfileFromTaskOrNode(node, 'compute')
                                .then(function (render) {
                                    return(render);
                                });
                        });
                } else {
                    return { profile: 'redirect.ipxe', ignoreLookup: true };
                }
            })
            .catch(function (err) {
                if (!err.status) {
                    throw new Errors.InternalServerError(err);
                } else {
                    throw err;
                }
            });
    };

    ProfileApiService.prototype.getProfilesSwitchVendor = function(
        requestIp, vendor
    ) {
        var self = this;
        return waterline.lookups.findOneByTerm(requestIp)
            .then(function(record) {
                return record.macAddress;
            })
            .then(function(macAddress) {
                return self.getMacs(macAddress);
            })
            .then(function(macAddresses) {
                var options = {
                    type: 'switch',
                    switchVendor: vendor
                };
                return self.getNode(macAddresses, options);
            })
            .then(function(node) {
                return self.getProfileFromTaskOrNode(node, 'switch');
            })
            .catch(function (err) {
                throw err;
            });
        };

    ProfileApiService.prototype.postProfilesSwitchError = function(error) {
        logger.error('SWITCH ERROR DEBUG ', error);
    };

    return new ProfileApiService();
}
