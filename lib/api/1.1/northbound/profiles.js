// Copyright 2015-2016, EMC, Inc.

'use strict';

var di = require('di');
var express = require('express');
var parser = require('body-parser');

module.exports = profilesRouterFactory;

di.annotate(profilesRouterFactory, new di.Provide('Http.Api.Profiles'));
di.annotate(profilesRouterFactory,
    new di.Inject(
        'Promise',
        'Profiles',
        'common-api-presenter'
    )
);

function profilesRouterFactory (
    Promise,
    profiles,
    presenter
) {
    var router = express.Router();

    /**
     * @api {get} /api/1.1/profiles/library GET /library
     * @apiVersion 1.1.0
     * @apiDescription get list of possible profiles
     * @apiName profiles-library-get
     * @apiGroup profiles
     * @apiSuccess {json} profiles list of the available library.
     */

    router.get('/profiles/library', presenter.middleware(function () {
        return Promise.map(profiles.getAll(), function(p) {
            return profiles.get(p.name);
        });
    }));


    /**
     * @api {get} /api/1.1/profiles/library/:identifier GET /library/:identifier
     * @apiVersion 1.1.0
     * @apiDescription get a single profile
     * @apiName profile-library-service-get
     * @apiGroup profiles
     * @apiParam {String} identifier String representation of the ObjectId
     * @apiParamExample {String }Identifier-Example:
     *      "end-ipxe.ipxe"
     * @apiError NotFound There is no profile in the library with <code>identifier</code>
     * @apiErrorExample Error-Response:
     *     HTTP/1.1 404 Not Found
     *     {
     *       "error": "Not Found"
     *     }
     */

    router.get('/profiles/library/:identifier', function (req, res) {
        presenter(req, res)
            .renderPlain(profiles.get(req.params.identifier));
    });


    /**
     * @api {put} /api/1.1/profiles/library/:identifier PUT
     * @apiVersion 1.1.0
     * @apiDescription put a single profile
     * @apiName profile-library-service-put
     * @apiParam {String} identifier Profile identifier
     * @apiHeader {String} Content-Type=application/octet-stream
     * @apiGroup profiles
     * @apiError Error problem was encountered, profile was not written.
     * @apiErrorExample Error-Response:
     *     HTTP/1.1 500 Error
     *     {
     *       "error": "upload failed."
     *     }
     */

    router.put('/profiles/library/:identifier', function(req, res) {
        return profiles.put(req.params.identifier, req)
        .then(function(profile) {
            res.status(200).json(profile);
        })
        .catch(function(err) {
            res.status(500).json(err);
        });
    });

    return router;
}
