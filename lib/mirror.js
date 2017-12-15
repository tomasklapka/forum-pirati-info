"use strict";

const express = require('express'),
    join = require('path').join,
    favicon = require('serve-favicon'),
    rewrite = require('express-urlrewrite'),
    morgan = require('morgan'),
    bodyParser = require('body-parser'),
    { URL } = require('url');

const debug = require('debug')('mirror');
const Scrapper = require('./scrapper');

class Mirror {
    constructor(options) {
        options = options || {};
        this.scrapper = options.scrapper;
        this.app = options.express || express();
        this.logger = options.logger || morgan('dev');
        this.baseOrigin = options.baseOrigin || 'https://forum.pirati.cz';
        this.port = options.port || 3042;
        this.viewDir = options.viewDir || join(__dirname, '/../views');
        this.viewEngine = options.viewEngine || 'pug';
        this.staticDir = options.staticDir || join(__dirname, '/../public');
        this.expressEnables = options.expressEnables || [ 'trust proxy' ];
        this.expressMiddlewares = options.expressMiddlewares || [ cors_enable ];

        this.app.set('json spaces', 2);
        this.app.set('port', this.port);
        this.app.set('views', this.viewDir);
        this.app.set('view engine', this.viewEngine, 'pug');
        for (let i = 0; i < this.expressEnables.length; i++) {
            this.app.enable(this.expressEnables[i]);
        }
        for (let i = 0; i < Scrapper.rewriteRules.length; i++) {
            const rule = Scrapper.rewriteRules[i];
            this.app.use(rewrite(rule[0], rule[1]));
        }
        this.app.use(favicon(join(this.staticDir, '/favicon.ico')));
        this.app.use(express.static(this.staticDir));
        this.app.use(this.logger);
        this.app.use(bodyParser.json());

        for (let i = 0; i < this.expressMiddlewares.length; i++) {
            this.app.use(this.expressMiddlewares[i]);
        }

        this.app.get('*', (req, res) => {
            this.route(req, res);
        });
    }

    route(req, res) {
        debug('route("%s")', req.originalUrl);
        const url = new URL(this.baseOrigin + req.originalUrl);
        const jsonRequest = consume_query_boolean_parameter(url, 'json');
        const nocacheRequest = consume_query_boolean_parameter(url, 'nocache');
        const scrapUrl = Scrapper.rewrite(url);
        debug('scrapUrl: "%o"', scrapUrl);

        if (url.pathname === '/download/file.php') {
            this.scrapper.request(url.href).pipe(res);
            return;
        }

        this.scrapper
            .get({
                url: scrapUrl,
                nocache: nocacheRequest
            }).then((data) => {
                const accepted = req.accepts('text/html', 'application/json', 'application/ld+json');
                if (accepted === 'application/json' || jsonRequest) {
                    debug('returning json');
                    res.json(data);
                    return;
                }
                debug('data.typeId: "%d"', data.typeId);
                if (data.typeId === Scrapper.PageType.Resource) {
                    debug('scraping resource - not implemented');
                    return;
                }
                const view = get_view_name(scrapUrl);
                debug('returning html view "%s" for "%s"', view, scrapUrl);
                res.render(view, data);
            }).catch((err) => {
                debug('route() scrapper error: "%o"', err);
                res.status(500).send('scrapper error: "' + (err.code || err) + '"');
            });
    }

    listen() {
        this.app.listen(this.port, () => {
            debug('listening on "%d"', this.port);
            console.log('Mirror listening on port ' + this.port);
        });
    }
}

module.exports = Mirror;

function cors_enable(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
}

function consume_query_parameter(url, param) {
    const value = url.searchParams.get(param);
    if (value) {
        url.searchParams.delete(param)
    }
    return value;
}

function normalize_boolean_query_parameter(option) {
    option = option && option.length > 0 ? option.toLowerCase() : option;
    return option === 'true' || option === 'on' || option === '1' ||
        option === '' || option === true;
}

function consume_query_boolean_parameter(url, param) {
    return normalize_boolean_query_parameter(consume_query_parameter(url, param));
}

function get_view_name(url) {
    const mapRouteView = {
        '/': () => { return 'forum' },
        '/viewforum.php': () => { return 'forum' },
        '/viewtopic.php': () => { return 'topic' },
        '/memberlist.php': (mode) => { return mode === 'viewprofile' ? 'user' : 'group' },
        '/search.php': (mode, sr) => { return sr === 'posts' ? 'topic' : 'forum' },
    };

    let getter = mapRouteView[url.pathname];
    if (getter) {
        return getter(url.searchParams.get('mode'), url.searchParams.get('sr'));
    }
    return null;
}
