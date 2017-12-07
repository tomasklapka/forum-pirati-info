"use strict";

const debug = require('debug')('routes/forum');
const { URL } = require('url');

const ForumScrapper = require('../lib/forum_scrapper');

function renderError(res, err) {
    debug('500 backend error');
    debug(err);
    res.status(500).send('backend error');
}

function render(req, res, view, data) {
    debug('req.params: %o', req.params);
    debug('req.query: %o', req.query);
    const accepted = req.accepts('text/html', 'application/json', 'application/ld+json');
    debug('accepted: "%s"', accepted);
    // json
    const jsonQueryRequest = req.query.json === '' || req.query.json === 'true' || req.query.json === '1';
    if (accepted === 'application/json' || jsonQueryRequest) {
        res.json(data);
        return;
    }
    // text/html
    res.render(view, data);
}

function scrapAndRender(url, view, req, res, cache, isPostUrl, originUrl, cached) {
    const scrapingQueue = req.app.get('scrapingQueue');
    ForumScrapper
        .scrap(url, req.app.get('base'), req.app.get('originBase'))
        .then((data) => {

            if (isPostUrl) {
                cache.setPostUrl(originUrl, data.url).catch((err) => {
                    debug(err);
                });
            }

            // queue links for crawling
            debug('data.links.length: "%d"',  data.links.length);
            if (data.links && data.links.length > 0) {
                data.links.forEach((link) => {
                    if (link.url.indexOf(req.app.get('base')) === 0) { // stay in base
                        scrapingQueue.queue(link.url, null, link.type)
                    }
                });
            }
            delete data.links;

            cache.save(data).catch(debug);
            render(req, res, view, data);
        })
        .catch((err) => {
            if (cached !== null) {
                debug('using cached content, because scrapper error: "%o"', err);
                render(req, res, view, cached.content);
            } else {
                renderError(res, err);
            }

        });
}

function getDataAndRender(url, view, req, res, isPostUrl, originUrl) {

    const cache = req.app.get('jsonCache');

    cache.load(url).then((cached) => {
        debug('valid json in cache?');
        const nocacheRequest = req.query.nocache === '' || req.query.nocache === 'true' || req.query.nocache === '1';
        if (nocacheRequest) { debug('nocache request - invalidating'); }
        if (cached === null || cached.invalid || nocacheRequest) {
            debug('no... scrapping...');
            scrapAndRender(url, view, req, res, cache, isPostUrl, originUrl, cached)
        } else {
            debug('yes');
            render(req, res, view, cached.content);
        }
    }).catch((err) => { renderError(res, err); });

}

function forumRoute(view, req, res) {
    debug('View: %s', view);
    const originBase = req.app.get('originBase');
    let originUrl = new URL(originBase + req.originalUrl);
    originUrl.searchParams.delete('json');
    originUrl.searchParams.delete('nocache');
    originUrl = originUrl.toString();
    let url = originUrl;

    if (/\/post\d+\.html/.exec(originUrl)) {
        cache.getPostUrl(originUrl).then((postUrl) => {
            if (postUrl) {
                url = postUrl;
                debug('new Url: %s', url);
            }
            getDataAndRender(url, view, req, res, true, originUrl);
        });
    } else {
        getDataAndRender(url, view, req, res);
    }
}

module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
module.exports.user = (req, res) => { forumRoute('user', req, res); };
module.exports.group = (req, res) => { forumRoute('group', req, res); };
module.exports.file = (req, res) => {
    ForumScrapper.request(req.app.get('originBase') + req.originalUrl).pipe(res)
};