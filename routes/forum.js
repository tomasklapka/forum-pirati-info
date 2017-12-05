"use strict";

const debug = require('debug')('routes/forum');
const { URL } = require('url');

const ForumScrapper = require('../lib/forum_scrapper');

function forumRoute(view, req, res) {
    debug(view);
    const originBase = req.app.get('originBase');
    let originUrl = new URL(originBase + req.originalUrl);
    originUrl.searchParams.delete('json');
    originUrl = originUrl.toString();
    const jsonRequest = req.query.json === '' || req.query.json === 'true' || req.query.json === '1';

    ForumScrapper.scrap(originUrl, req.app.get('base'), originBase).then((data) => {
        debug(req.params);
        const accepted = req.accepts('text/html', 'application/json', 'application/ld+json');
        debug(accepted);
        if (accepted === 'application/json' || jsonRequest) {
            res.json(data);
            return;
        }
        // fallback to text/html
        res.render(view, data);
    }).catch((err) => {
        debug('500 backend error');
        debug(err);
        res.status(500).send("backend error");
    });
}

module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
module.exports.user = (req, res) => { forumRoute('user', req, res); };
module.exports.group = (req, res) => { forumRoute('group', req, res); };
module.exports.file = (req, res) => {
    ForumScrapper.request(req.app.get('sameAsBase') + req.originalUrl).pipe(res)
};