"use strict";

const debug = require('debug')('routes/forum');
const request = require('request');
const { URL } = require('url');

const ForumScrapper = require('../lib/forum_scrapper');

function forumRoute(view, req, res) {
    debug(req.router);
    const originBase = req.app.get('sameAsBase');
    let originUrl = new URL(originBase + req.originalUrl);
    originUrl.searchParams.delete('json');
    originUrl = originUrl.toString();
    const jsonRequest = req.query.json === '' || req.query.json === 'true' || req.query.json === '1';

    const scrapper = new ForumScrapper(originUrl, req.app.get('base'), originBase);
    const PageType = scrapper.map.PageType;
    scrapper
        .scrap().then((data) => {
        if (data.links && data.links.length > 0) {
            data.links.forEach((link) => {
                if (link.url.indexOf(originBase) === 0) {
                    if ((link.type === PageType.Forum) ||
                        (link.type === PageType.Thread) ||
                        (link.type === PageType.Group) ||
                        (link.type === PageType.User)) {
                        //debug('queueing: "%s"', link.url);
                        // TODO queue for scrapping.
                    }
                }
            });
        }
        data.typeId = data.type;
        for (const t in PageType) {
            if (PageType.hasOwnProperty(t) && PageType[t] === data.typeId) {
                data.type = t
            }
        }
        let properties = [ '$', 'request', 'defaultRequest', 'httpRequestCache' ];
        properties.forEach((prop) => {
            delete data[prop];
        });
        if (data.user.username === null) {
            data.user = null;
        }
        if (data.poll && (!data.poll.title || data.poll.title.length === 0)) {
            data.poll = null;
        }

        data['sameAs'] = originUrl;
        data['asJson'] = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
        data['asJson'].searchParams.set('json', 'true');
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

module.exports.index = (req, res) => { forumRoute('forum', req, res); };
module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.activeTopics = (req, res) => { forumRoute('forum', req, res); };
module.exports.unanswered = (req, res) => { forumRoute('forum', req, res); };
module.exports.unreadPosts = (req, res) => { forumRoute('forum', req, res); };

module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
module.exports.viewTopic = (req, res) => { forumRoute('topic', req, res); };
module.exports.searchPosts = (req, res) => { forumRoute('topic', req, res); };
module.exports.userPosts = (req, res) => { forumRoute('topic', req, res); };
module.exports.newPosts = (req, res) => { forumRoute('topic', req, res); };

module.exports.post = (req, res) => { forumRoute('post', req, res); };

module.exports.user = (req, res) => { forumRoute('user', req, res); };

module.exports.group = (req, res) => { forumRoute('memberList', req, res); };
module.exports.memberList = (req, res) => { forumRoute('memberList', req, res); };

module.exports.file = (req, res) => {
    ForumScrapper.request(req.app.get('sameAsBase') + req.originalUrl).pipe(res)
};