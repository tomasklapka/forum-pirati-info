"use strict";

const debug = require('debug')('routes/forum');

const ForumScrapper = require('../lib/forum_scrapper');

function forumRoute(view, req, res) {
    const originBase = req.app.get('sameAsBase');
    const originUrl = originBase + req.originalUrl;

    const scrapper = new ForumScrapper(originUrl);
    const PageType = scrapper.PageType;
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
            if (PageType.hasOwnProperty(t) && PageType[t] == data.typeId) {
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
        const r = {};
        r['owl:sameAs'] = originUrl;
        r['path'] = req.route.path;
        r['params'] = req.params;
        r['route'] = req.route;
        data['_debug'] = r;
        debug(req.route.path);
        debug(req.params);
        res.json(data);
    }).catch((err) => {
        res.json({'err': err});
    });
}

module.exports.index = (req, res) => { forumRoute('index', req, res); };
module.exports.unreadPosts = (req, res) => { forumRoute('unreadPosts', req, res); };
module.exports.newPosts = (req, res) => { forumRoute('newPosts', req, res); };
module.exports.activeTopics = (req, res) => { forumRoute('activeTopics', req, res); };
module.exports.unanswered = (req, res) => { forumRoute('unanswered', req, res); };
module.exports.memberList = (req, res) => { forumRoute('memberList', req, res); };
module.exports.viewTopic = (req, res) => { forumRoute('viewTopic', req, res); };
module.exports.post = (req, res) => { forumRoute('post', req, res); };
module.exports.user = (req, res) => { forumRoute('user', req, res); };
module.exports.userPosts = (req, res) => { forumRoute('userPosts', req, res); };
module.exports.group = (req, res) => { forumRoute('group', req, res); };
module.exports.forum = (req, res) => { forumRoute('forum', req, res); };
module.exports.topic = (req, res) => { forumRoute('topic', req, res); };
