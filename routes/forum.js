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

function getDataAndRender(url, view, req, res, cache, isPostUrl, originUrl) {

    // load json from cache
    cache.load(url).then((cached) => {
        // json in cache?
        debug('json in cache?');
        if (cached === null) {
            // no... proceed with scrapping
            debug('no... scrapping...');
            ForumScrapper
                .scrap(url, req.app.get('base'), req.app.get('originBase'))
                .then((data) => {
                    // cache post url if post url
                    if (isPostUrl) {
                        cache.setPostUrl(originUrl, data.url).catch((err) => {
                            debug(err);
                        });
                    }
                    // save scrapped json if cacheable
                    cache.save(data).catch((err) => {
                        debug(err);
                    });
                    // return scrapped json
                    render(req, res, view, data);
                })
                .catch((err) => {
                    renderError(res, err);
                });
        } else {
            // yes... return json from cache
            debug('yes');
            render(req, res, view, cached.content);
        }
    }).catch((err) => { renderError(res, err); });

}

function forumRoute(view, req, res) {
    debug('View: %s', view);
    const cache = req.app.get('jsonCache');
    const originBase = req.app.get('originBase');
    let originUrl = new URL(originBase + req.originalUrl);
    originUrl.searchParams.delete('json');
    originUrl = originUrl.toString();
    let url = originUrl;

    if (/\/post\d+\.html/.exec(originUrl)) {
        cache.getPostUrl(originUrl).then((postUrl) => {
            if (postUrl) {
                url = postUrl;
                debug('new Url: %s', url);
            }
            getDataAndRender(url, view, req, res, cache, true, originUrl);
        });
    } else {
        getDataAndRender(url, view, req, res, cache);
    }
}

module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
module.exports.user = (req, res) => { forumRoute('user', req, res); };
module.exports.group = (req, res) => { forumRoute('group', req, res); };
module.exports.file = (req, res) => {
    ForumScrapper.request(req.app.get('originBase') + req.originalUrl).pipe(res)
};