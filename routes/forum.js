"use strict";

const debug = require('debug')('routes/forum');
const { URL } = require('url');

const ForumScrapper = require('../lib/forum_scrapper');

function renderError(res, err, status = 500) {
    debug('%d backend error "%o"', status, (err.code||err));
    res.status(status).send(status + ' backend error ('+(err.code||err)+')');
}

function render(req, res, view, data) {
    // debug('req.params: %o', req.params);
    // debug('req.query: %o', req.query);
    const accepted = req.accepts('text/html', 'application/json', 'application/ld+json');
    // debug('accepted: "%s"', accepted);
    // json
    const jsonQueryRequest = req.query.json === '' || req.query.json === 'true' || req.query.json === '1';
    if (accepted === 'application/json' || jsonQueryRequest) {
        res.json(data);
        return;
    }
    // text/html
    res.render(view, data);
}

function scrapAndRender(url, view, req, res, cached) {
    const scrapingQueue = req.app.get('scrapingQueue');
    ForumScrapper
        .scrap(url, req.app.get('base'), req.app.get('originBase'))
        .then((data) => {
            if (data.statusCode === 200) {
                // debug('data.links.length: "%d"',  data.links.length);
                scrapingQueue.discoverIdsFromLinks(data.links);
                delete data.links;
                delete data.statusCode;
                delete data.status;
                // debug('saving: %d %s', data.phpbbid, data.url);

                if (data.typeid > 0) {
                    const db = req.app.get('db');
                    db.save(data).catch(debug);
                    const cache = req.app.get('jsonCache');
                    cache.save(data).catch(debug);
                    render(req, res, view, data);
                } else {
                    debug('internal error');
                    debug(data);
                    res.status(500).send('internal server error');
                }
            } else {
                debug('scraping error: %d "%s"', data.statusCode, data.status);
                res.status(data.statusCode).send(data.status);
            }
        })
        .catch((err) => {
            if (cached !== null) {
                debug('using cached content');
                render(req, res, view, cached.content);
            } else {
                debug('no cached content');
                let status = 500;
                switch (err.code) {
                    case 'ECONNRESET':
                    case 'ECONNREFUSED': status = 502; break;
                    case 'ESOCKETTIMEDOUT': status = 504; break;
                }
                renderError(res, err, status);
            }
        });
}

function getDataAndRender(url, view, req, res) {

    const cache = req.app.get('jsonCache');

    cache.load(url).then((cached) => {
        // debug('valid json in cache?');
        const nocacheRequest = req.query.nocache === '' || req.query.nocache === 'true' || req.query.nocache === '1';
        // if (nocacheRequest) { debug('nocache request - invalidating'); }
        if (cached === null || cached.invalid || nocacheRequest) {
            //debug('no... scrapping...');
            scrapAndRender(url, view, req, res, cached)
        } else {
            // debug('yes');
            render(req, res, view, cached.content);
        }
    }).catch((err) => { renderError(res, err); });

}

function forumRoute(view, req, res) {
    // debug('View: %s', view);
    const originBase = req.app.get('originBase');
    let originUrl = new URL(originBase + req.originalUrl);
    originUrl.searchParams.delete('json');
    originUrl.searchParams.delete('nocache');
    originUrl = originUrl.toString();
    let url = originUrl;

    debug('GET %s', url);

    if (/\/post\d+\.html/.exec(originUrl)) {
        const post_phpbbid = ForumScrapper.postIdFromUrl(originUrl);
        req.app.get('db').post(post_phpbbid).then((post) => {
            if (post && post.url) {
                url = originBase + post.url;
                debug('new url: %s', url);
            }
            getDataAndRender(url, view, req, res);
        }).catch((err) => {
            debug(err);
            getDataAndRender(url, view, req, res);
        } );
    } else {
        getDataAndRender(url, view, req, res);
    }
}

module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
module.exports.user = (req, res) => { forumRoute('user', req, res); };
module.exports.group = (req, res) => { forumRoute('group', req, res); };
module.exports.pipe = (req, res) => {
    ForumScrapper.request(req.app.get('originBase') + req.originalUrl).pipe(res)
};