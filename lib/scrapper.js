"use strict";

const fs = require('fs'),
    join = require('path').join,
    cheerio = require('cheerio'),
    request = require('request'),
    { URL } = require('url');

const debug = require('debug')('scrapper');
const jarredRequest = request.defaults({ jar: true });
const jsonVersion = 2;
const PageType = {
    None: '0',
    Root: '1',
    Forum: '2',
    Topic: '3',
    Group: '4',
    User: '5',
    Search: '6',
    Unanswered: '7',
    ActiveTopics: '8',
    UserPosts: '9',
    UserTopics: '10',
    MemberList: '11',
    Resource: '12',
    Static: '13',
};
const rewriteRules = [
    [ /^\/(forum|[a-z0-9_-]*-f)([0-9]+)\/?(page([0-9]+)\.html)?$/, '/viewforum.php?f=$2&start=$4' ],
    [ /^\/(forum|[a-z0-9_-]*-f)([0-9]+)\/(topic|[a-z0-9_-]*-t)([0-9]+)(-([0-9]+))?\.html$/, '/viewtopic.php?f=$2&t=$4&start=$6' ],
    [ /^\/([a-z0-9_-]*)\/?(topic|[a-z0-9_-]*-t)([0-9]+)(-([0-9]+))?\.html$/, '/viewtopic.php?forum_uri=$1&t=$3&start=$5' ],
    [ /^\/resources\/[a-z0-9_-]+\/(thumb\/)?([0-9]+)$/, '/download/file.php?id=$2&t=$1' ],
    [ /^\/(member|[a-z0-9_-]*-u)([0-9]+)\/?$/, '/memberlist.php?mode=viewprofile&u=$2' ],
    [ /^\/(member|[a-z0-9_-]*-u)([0-9]+)\/(topics|posts)\/?(page([0-9]+)\.html)?$/, '/search.php?author_id=$2&sr=$3&start=$5' ],
    [ /^\/(group|[a-z0-9_-]*-g)([0-9]+)(-([0-9]+))?\.html$/, '/memberlist.php?mode=group&g=$2&start=$4' ],
    [ /^\/post([0-9]+)\.html$/, '/viewtopic.php?p=$1' ],
    [ /^\/active-topics(-([0-9]+))?\.html$/, '/search.php?search_id=active_topics&start=$2&sr=topics' ],
    [ /^\/unanswered(-([0-9]+))?\.html$/, '/search.php?search_id=unanswered&start=$2&sr=topics' ],
    [ /^\/newposts(-([0-9]+))?\.html$/, '/search.php?search_id=newposts&start=$2&sr=topics' ],
    [ /^\/unreadposts(-([0-9]+))?\.html$/, '/search.php?search_id=unreadposts&start=$2' ],
    // [ /^\/the-team\.html$/, '/memberlist.php?mode=leaders' ],
    // [ /^\/rss(\/(news)+)?(\/(digest)+)?(\/(short|long)+)?\/?$/, '/gymrss.php?channels&$2&$4&$6' ],
    // [ /^\/(news|maps)\/?(page([0-9]+)\.html)?$/, '/map.php?$1&start=$3' ],
    [ /^\/([a-z0-9_-]+)\/?(page([0-9]+)\.html)?$/, '/viewforum.php?forum_uri=$1&start=$3' ],
    [ /^\/.+\/(style\.php|ucp\.php|mcp\.php|faq\.php|download\/file.php)$/, '/$1' ],
    [ /^\/(.+\/)?(styles\/.*|images\/.*)$/, '/$2' ],
    // [ /^\/(news|maps)\/([a-z0-9_-]+)(\/([a-z0-9_-]+))?\/?(page([0-9]+)\.html)?$/, '/map.php?$2=$4&$1&start=$6' ],
    // [ /^\/rss(\/(news)+)?(\/(digest)+)?(\/(short|long)+)?(\/([a-z0-9_-]+))?\/([a-z0-9_]+)\.xml(\.gz)?$/, '/gymrss.php?$9=$8&$2&$4&$6&gzip=$10' ],
    // [ /^\/[a-z0-9_-]*-[a-z]{1,2}([0-9]+)(\/(news)+)?(\/(digest)+)?(\/(short|long)+)?\/([a-z0-9_]+)\.xml(\.gz)?$/, '/gymrss.php?$8=$1&$3&$5&$7&gzip=$9' ],
    // [ /^\/([a-z0-9_-]+)(\/(news)+)?(\/(digest)+)?(\/(short|long)+)?\/([a-z0-9_]+)\.xml(\.gz)?$/, '/gymrss.php?nametoid=$1&$3&$5&$7&modulename=$8&gzip=$9' ],
    // [ /^\/sitemapindex\.xml(\.gz)?$/, '/sitemap.php?gzip=$1' ],
    // [ /^\/[a-z0-9_-]+-([a-z]{1,2})([0-9]+)\.xml(\.gz)?$/, '/sitemap.php?module_sep=$1&module_sub=$2&gzip=$3' ],
    // [ /^\/([a-z0-9_]+)-([a-z0-9_-]+)\.xml(\.gz)?$/, '/sitemap.php?$1=$2&gzip=$3' ]
];

class ScrapData {

    constructor(url, base, baseOrigin) {
        this.url = url;
        this.$ = null;
        this.phpbbid = null;
        this.typeId = null;
        this.type = null;
        this.title = null;
        this.unbased = null;
        this.mirrorUrl = null;
        this.asJson = null;
        this.meta = {
            path: url.pathname,
            query: url.searchParams,
            status: 'OK',
            statusCode: 200,
            cacheable: false,
            base: base,
            baseOrigin: baseOrigin,
            version: jsonVersion,
        };
        this.navi = {
            page: null,
            pages: null,
            pager: null,
            first: null,
            prev: null,
            next: null,
            forum: null,
            forumTitle: null,
            parent: null,
            parentTitle: null,
        };
        this.user = {
            username: null,
            signature: null,
            avatar: null,
            rank: null,
            address: null,
            age: null,
            occupation: null,
            defaultGroup: null,
            groups: {},
            interests: null,
            profession: null,
            icq: null,
            www: null,
            jabber: null,
            registered: null,
            lastVisit: null,
            totalPosts: null,
            likesGot: null,
            likesGave: null,
            showOnMap: false
        };
        this.color = null;
        this.rules = null;
        this.poll = null;
        this.moderators = { users: [], groups: [] };
        this.sections = {};
        this.forums = {};
        this.announcements = {};
        this.topics = {};
        this.posts = [];
        this.users = {};
        this.links = [];
    }
}

class Scrapper {

    constructor(options) {
        options = options || {};
        this.db = options.db;
        this.cache = options.cache;
        this.base = options.base;
        this.baseOrigin = options.baseOrigin;
        this.username = options.username;
        this.password = options.password;
        this.request = options.request || jarredRequest;
        this.requestTimeout = options.requestTimeout || 500;
        this.dataDir = options.dataDir || join(__dirname, '/../data');
    }

    get(options) {
        debug('this.get("%s") %s', options.url, options.nocache ? 'nocache' : '');
        return new Promise((resolve, reject) => {
            options = options || { };
            const url = options.url;
            const nocache = options.nocache;

            this.getFromCache(url, nocache).then((cached) => {
                if (cached === null || cached.invalid) {
                    this.scrap(url).then((scrapped) => {
                        resolve(scrapped)
                    }).catch((err) => {
                        debug('get() error: "%o"', err);
                        reject(err);
                    })
                } else {
                    resolve(cached);
                }
            });
        });
    }

    getFromCache(url, nocache) {
        return new Promise((resolve) => {
            if (this.cache && !nocache) {
                this.cache.load(url).then(resolve).catch((err) => {
                    debug('this.cache.load("%s") error: "%o"', url, err);
                    resolve(null);
                });
            } else {
                resolve(null);
            }
        });
    }

    saveToCache(sd) {
        if (this.cache) {
            return this.cache.save(sd);
        }
        return Promise.resolve();
    }

    login() {
        const url = new URL(this.baseOrigin + '/ucp.php?mode=login');
        debug('this.login("%s", "%s", "%s")', url, this.username, '***invisible***');
        return new Promise((resolve, reject) => {
            if (!url || !this.username || !this.password) {
                resolve(null);
                return;
            }
            this.request({
                url: url,
                method: 'POST',
                timeout: this.requestTimeout,
                form: {
                    username: this.username,
                    password: this.password,
                    viewonline: 'on',
                    login: 'Přihlásit se'
                }
            }, (error, response) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(response);
            });
        });
    }

    requiresLogin(sd) {
        const $ = sd.$;
        let requires = false;
        // debug('login check?');
        $('li.icon-logout > a').each((i, p) => {
            if ($(p).text() === 'Přihlásit se') {
                debug('requires login...');
                requires = true;
            }
        });
        return requires;
    }

    scrap(url) {
        debug('this.scrap("%s")', url.href);
        return new Promise((resolve, reject) => {
            this.request({
                url: url,
                timeout: this.requestTimeout
            }, (err, response, body) => {
                const wasRequestRejected = reject_on_request_error(err, body, reject);
                if (wasRequestRejected) {
                    return;
                }
                const typeId = Scrapper.linkType(url);
                debug('typeId: "%s"', typeId);
                if (typeId === PageType.Resource) {
                    debug('resource %d bytes', body.length);
                    this.scrapResource(url, body).then(resolve).catch(reject);
                    return;
                }
                const sd = new ScrapData(url, this.base, this.baseOrigin);
                sd.$ = cheerio_load_or_reject(body, reject, 'cheerio load error: page="'+url.href+'"\n\tmessage: "%o"');
                const wasCheerioLoadRejected = sd.$ === false;
                if (wasCheerioLoadRejected) {
                    return;
                }

                if (this.requiresLogin(sd)) {
                    this.login().then(() => {
                        this.scrap(url).then(resolve).catch((err) => {
                            debug('scrap after login, error: "%o"', err);
                            reject(err);
                        });
                    }).catch((err) => {
                        debug('login error "%o"', err);
                        reject(err);
                    });
                    return;
                }

                sd.typeId = typeId;
                sd.meta.cacheable = Scrapper.isCacheable(sd.typeId);

                switch (typeId) {
                    case PageType.Root:
                    case PageType.Forum:
                    case PageType.UserTopics:
                    case PageType.Unanswered:
                    case PageType.ActiveTopics:
                        this.scrapForum(sd);
                        break;
                    case PageType.Topic:
                    case PageType.Search:
                    case PageType.UserPosts:
                        this.scrapTopic(sd);
                        break;
                    case PageType.User:
                        this.scrapUser(sd);
                        break;
                    case PageType.Group:
                    case PageType.MemberList:
                        this.scrapGroup(sd);
                        break;
                }
                this.scrapLinks(sd);
                this.scrapParent(sd);
                this.scrapPagination(sd);

                // debug(sd.url.href);
                sd.mirrorUrl = sd.url.href.replace(this.baseOrigin, this.base);
                for (const t in PageType) {
                    if (PageType.hasOwnProperty(t) && PageType[t] === sd.typeId) {
                        sd.type = t
                    }
                }
                if (sd.user.username === null) {
                    sd.user = null;
                }
                if (sd.poll && (!sd.poll.title || sd.poll.title.length === 0)) {
                    sd.poll = null;
                }
                sd.unbased = this.unbase(url);
                sd.asJson = new URL(sd.mirrorUrl);
                sd.asJson.searchParams.set('json', true);
                sd.asJson = sd.asJson.toString();
                debug('resolving sd');
                this.saveToCache(sd);
                resolve(sd);
            });
        });
    }

    scrapPostBBCode(post_id) {
        const url = new URL (this.baseOrigin + '/ucp.php?i=pm&mode=compose&action=quotepost&p=' + post_id);
        debug('this.scrapPostBBCode(%d) - "%s"', post_id, url.href);
        return new Promise((resolve, reject) => {
            this.request({
                url: url,
                timeout: this.requestTimeout
            }, (err, response, body) => {
                const wasRequestRejected = reject_on_request_error(err, body, reject);
                const $ = cheerio_load_or_reject(body, reject, 'cheerio load error: post="'+url.href+'"\n\tmessage: "%o"');
                const wasCheerioLoadRejected = $ === false;
                if (wasRequestRejected || wasCheerioLoadRejected) {
                    return;
                }
                const regexp_quote_open = new RegExp('^\\[url[^\\]]+\\][^\\[]*\\[/url\\]\\s+\\[quote="[^"]+"\\]', 'm');
                const regexp_quote_close = new RegExp('\\[\/quote\\]\\n$', 'm');
                const content = $('textarea#message')
                    .text()
                    .replace(regexp_quote_open, '')
                    .replace(regexp_quote_close, '');
                // debug('post="%d" BBCode: "%s"', post_id, content);
                resolve(content);
            });
        });

    }

    scrapResource(url) {
        return new Promise((resolve) => {
            debug('this.scrapResource: "%s"', url);
            resolve({
                "url": url,
                "typeId": PageType.Resource,
            });
        });
    }

    scrapRules(sd) {
        debug('this.scrapRules()');
        const $ = sd.$;
        sd.rules = $('div.rules > div.inner').html();
        if (sd.rules && sd.rules.length > 0) {
            sd.rules = sd.rules.replace(this.baseOrigin, this.base);
        }
        return sd;
    }

    scrapLinks(sd) {
        debug('this.scrapLinks()');
        const $ = sd.$;
        $('a').each((i, a) => {
            let url = $(a).attr('href');
            const typeId = Scrapper.linkType(url);
            if ((url || typeof url === typeof 'string') && typeId !== PageType.None) {
                url = url.replace(/#wrap$/, '');
                sd.links.push({
                    title: $(a).text(),
                    url: url,
                    unbased: this.unbase(url),
                    typeId: typeId
                });
            }
        });
        return sd;
    }

    scrapParent(sd) {
        debug('this.scrapParent()');
        const $ = sd.$;
        const linkPath = $('div#page-header > div.navbar > div.inner > ul.navlinks > li.icon-home > a');
        sd.navi.forumBased = linkPath.last().attr('href');
        sd.navi.forum = this.unbase(sd.navi.forumBased);
        sd.navi.forumTitle = linkPath.last().text();
        if (linkPath.length > 1) {
            sd.navi.parentBased = linkPath.last().prev().prev().attr('href');
            sd.navi.parent = this.unbase(sd.navi.parentBased);
            sd.navi.parentTitle = linkPath.last().prev().prev().text();
        }
        return sd;
    }

    scrapLastPost(p, $) {
        // debug('this.scrapLastPost()');
        let lastPost = {
            username: null,
            user: null,
            post: null,
            created: null
        };
        $(p).find('span > a').each((i, p) => {
            let url = new URL($(p).attr('href'));
            // debug('scrapped last post url: "%s"', url);
            url = Scrapper.rewrite(url);
            // debug('last post url rewritten: "%s"', url);
            const urlType = Scrapper.linkType(url);
            // debug('lastPostUrl: "%s" (%d)', url, urlType);
            if (urlType === PageType.User) {
                lastPost.userBased = url;
                lastPost.user = this.unbase(url);
                lastPost.username = $(p).text();
                lastPost.userColor = color_from_style($(p));
            } else {
                if (urlType === PageType.Topic) {
                    lastPost.postBased = url;
                    lastPost.post = this.unbase(url);
                }
            }
        });
        if (!lastPost.user) {
            lastPost.username = p.children('span').children('span').text();
            lastPost.user = 'unregistered:'+lastPost.username;
            lastPost.userBased = lastPost.user;
        }
        if (lastPost.post) {
            const lastPostTime = p.children('span').text().split(/\n/);
            lastPost.created = parse_date(lastPostTime[lastPostTime.length-1].trim());
        } else {
            lastPost = null;
        }
        return lastPost;
    }

    scrapRowPages(body) {
        const pages = +body.children('strong.pagination').children('span').children('a').last().text();
        return pages === 0 ? 1 : pages;
    }

    scrapForum(sd) {
        debug('this.scrapForum()');
        const $ = sd.$;
        this.scrapRules(sd);
        sd.phpbbid = Scrapper.forumIdFromUrl(sd.url);
        sd.title = $('div#page-body > h2').text();
        // debug('title: "%s"', sd.title);
        if (!sd.title) {
            sd.title = $('title').text();
            // debug('new title: "%s"', sd.title);
        }
        let section = null;
        let sectionIndex = -1;
        $('.topiclist').each((i, p) => {
            if ($(p).hasClass('topics')) {
                // debug('topic section', i);
                $(p).children('li').each((i, p) => {
                    const dl = $(p).children('dl');
                    const topicBody = dl.children('dt');

                    const links = topicBody.children('a');
                    let topicLink;
                    let topicUrl = '';
                    let topicTitle = '';
                    let opUrl = '';
                    let opColor = '';
                    let opUsername = '';
                    let fUrl = '';
                    let fTitle = '';
                    links.each((i, p) => {
                        if ($(p).hasClass('topictitle')) {
                            topicLink = $(p);
                            topicUrl = topicLink.attr('href');
                            topicTitle = topicLink.text();
                        } else {
                            const url = $(p).attr('href');
                            const typeId = Scrapper.linkType(url, true);
                            debug('type "%s" %d', url, typeId);
                            if (typeId === PageType.User) {
                                opUrl = url;
                                opUsername = $(p).text();
                                opColor = color_from_style($(p));
                            } else {
                                if (typeId === PageType.Forum) {
                                    fUrl = url;
                                    fTitle = $(p).text();
                                }
                            }
                        }
                    });
                    if (opUrl === '') {
                        opUsername = topicBody.children('span').text();
                        opUrl = 'unregistered:'+opUsername;
                        opColor = color_from_style(topicBody.children('span'));
                    }
                    const op = topicBody.text();
                    const created = parse_date(op.replace(/^[\s\S]*» /, '').replace(/\n[\s\S]*$/, ''));
                    const nPosts = +dl.children('dd.posts').text().split(' ').shift();
                    const nViews = +dl.children('dd.views').text().split(' ').shift();
                    const lastPost = this.scrapLastPost(dl.children('dd.lastpost'), $);

                    const topic = {
                        phpbbid: Scrapper.topicIdFromUrl(topicUrl),
                        urlBased: topicUrl,
                        url: this.unbase(topicUrl),
                        title: topicTitle,
                        locked: (dl.attr('style').match(/locked.gif/) !== null),
                        pages: this.scrapRowPages(topicBody),
                        created: created,
                        userBased: opUrl,
                        user: this.unbase(opUrl),
                        username: opUsername,
                        userColor: opColor,
                        forumBased: fUrl,
                        forum: this.unbase(fUrl),
                        forumTitle: fTitle,
                        nPosts: nPosts,
                        nViews: nViews,
                        lastPost: lastPost,
                        section: sectionIndex,
                    };
                    if ($(p).hasClass('global-announce')) {
                        sd.announcements[topic.phpbbid] = topic;
                        sd.sections[sectionIndex].announcements.push(topic.phpbbid);
                    } else {
                        sd.topics[topic.phpbbid] = topic;
                        sd.sections[sectionIndex].topics.push(topic.phpbbid);
                    }
                })
            } else {
                if ($(p).hasClass('forums')) {
                    // debug('forum section', i);
                    $(p).children('li').each((i, p) => {
                        const dl = $(p).children('dl');
                        const forumBody = dl.children('dt');
                        const forumLinks = forumBody.children('a');
                        let forumUrl = '';
                        let forumTitle = '';
                        const subforums = [];
                        const moderators = [];
                        forumLinks.each((i, p) => {
                            const link = $(p);
                            if (link.hasClass('forumtitle')) {
                                forumUrl = link.attr('href');
                                forumTitle = link.text();
                            } else {
                                const linkObj = {
                                    urlBased: link.attr('href'),
                                    url: this.unbase(link.attr('href')),
                                    title: link.text()
                                };
                                if (link.hasClass('subforum')) {
                                    subforums.push(linkObj);
                                } else {
                                    moderators.push(linkObj);
                                }
                            }
                        });

                        const nTopics = +dl.children('dd.topics').text().split(' ').shift();
                        const nPosts = +dl.children('dd.posts').text().split(' ').shift();
                        const lastPost = this.scrapLastPost(dl.children('dd.lastpost'), $);

                        const forum = {
                            phpbbid: Scrapper.forumIdFromUrl(forumUrl),
                            urlBased: forumUrl,
                            url: this.unbase(forumUrl),
                            title: forumTitle,
                            locked: (dl.attr('style').match(/locked.gif/) !== null),
                            pages: this.scrapRowPages(forumBody),
                            nTopics: nTopics,
                            nPosts: nPosts,
                            lastPost: lastPost,
                            section: section.id,
                            subforums: subforums,
                            moderators: moderators
                        };
                        sd.forums[forum.phpbbid] = forum;
                        sd.sections[sectionIndex].forums.push(forum.phpbbid);
                    })
                } else {
                    // debug('section', sectionIndex);
                    sectionIndex++;
                    section = {
                        id: sectionIndex,
                        url: null,
                        title: null,
                        forums: [],
                        announcements: [],
                        topics: [],
                    };
                    const sectionBody = $(p).find('li > dl > dt');
                    const sectionLink = sectionBody.children('a');
                    if (sectionLink.length > 0) {
                        section.urlBased = sectionLink.attr('href');
                        section.url = this.unbase(section.urlBased);
                        section.title = sectionLink.text();
                    } else {
                        section.title = sectionBody.text();
                    }
                    sd.sections[sectionIndex] = section;
                }
            }
        });
    }

    scrapTopic(sd) {
        debug('this.scrapTopic()');
        const $ = sd.$;
        this.scrapRules(sd);
        this.scrapPoll(sd);
        const pageBody = $('div#page-body');
        sd.title = pageBody.children("h2").text();

        let moderatorsBody = pageBody.children('p').first();
        if (moderatorsBody.children('strong') === 0) {
            moderatorsBody = moderatorsBody.next();
        }
        if (moderatorsBody.length > 0) {
            moderatorsBody.children('a').each((i, p) => {
                const moderator = {
                    urlBased: $(p).attr('href'),
                    title: $(p).text()
                };
                moderator.url = this.unbase(moderator.urlBased);
                moderator.color = color_from_style($(p));
                const typeId = Scrapper.linkType(moderator.urlBased, true);
                if (typeId === PageType.Group) {
                    sd.moderators.groups.push(moderator);
                } else {
                    if (typeId === PageType.User) {
                        sd.moderators.users.push(moderator);
                    } else {
                        debug('unknown moderator type url: "%s"', moderator.urlBased);
                    }
                }
            });
        }

        $('div.post:has(div.postbody)').each((i, p) => {
            if (sd.meta.statusCode !== 200) {
                return;
            }
            const postBody = $(p).find('div.inner > div.postbody');
            const postProfileBody = $(p).find('div.inner > dl.postprofile');
            const titleLink = postBody.children('h3').children('a');
            let authorBody = postBody.children('p.author');
            let authorLink;
            let authorUrl;
            let authorName;
            let authorColor;
            let avatar;
            let created;
            let likes;

            if (authorBody.length > 0) {
                const authorLink = authorBody.children('strong').children('a');
                const likesBody = postBody.children('div.content').last().children('dl.postbody').children('dd').children('a');
                likes = [];
                likesBody.each((j, a) => {
                    const url = $(a).attr('href');
                    likes.push({
                        userBased: url,
                        user: this.unbase(url),
                        username: $(a).text(),
                        userColor: color_from_style($(a)),
                    });

                });
                created = this.convertCreatedDate(authorBody, $);
                authorUrl = authorLink.attr('href');
                authorName = authorLink.text();
                authorColor = color_from_style(authorLink);
                if (!authorUrl) {
                    authorName = authorBody.children('strong').children('span').text();
                    authorUrl = 'unregistered:' + encodeURIComponent(authorName);
                }
            }

            authorBody = postProfileBody.children('dt');
            authorLink = authorBody.children('a');
            avatar = authorLink.children('img').attr('src');
            if (avatar) {
                avatar = avatar.replace(/^\.\//, '/');
            }
            if (!authorName || !(authorName.length > 0)) {
                authorUrl = authorLink.attr('href');
                authorName = authorLink.text();
                authorColor = color_from_style(authorLink);
            }
            if (authorBody.hasClass('author')) {
                created = this.convertCreatedDate(authorBody.next(), $);
            }
            const profileFields = postProfileBody.children('dd');
            profileFields.first().text();

            const postUrl = (titleLink.attr('href') || '').replace(/\?[^#]*/, '');
            if (sd.phpbbid === null) {
                sd.phpbbid = Scrapper.topicIdFromUrl(postUrl);
                debug('scraping phpbbid: %o', sd.phpbbid);
            }
            const postid = Scrapper.postIdFromUrlHash(titleLink.attr('href'));
            debug(postid);

            const post = {
                phpbbid: postid,
                urlBased: postUrl,
                url: this.unbase(postUrl),
                title: titleLink.text(),
                userBased: authorUrl, //this.rebase(authorUrl),
                user: this.unbase(authorUrl),
                username: authorName,
                userColor: authorColor,
                avatar: avatar,
                userRank: null,
                userPosts:  null,
                userRegistered: null,
                created: created,
                content: this.normalizeLinks(postBody.children('div.content').first().html()),
                signature: this.normalizeLinks(postBody.children('div.signature').first().html()),
                likes: likes
            };

            /*
            if (/\/post\d+\.html/.exec(this.url)) {
                this.url = titleLink.attr('href').replace(/#[^#]*COMMENTREMOVE/, '');
            }
            */
            let currentDd = profileFields.first();
            let currentText = currentDd.text().trim();
            if (currentText !== '') {
                post.userRank = currentText;
                currentDd = currentDd.next();
            }
            currentDd = currentDd.next();
            post.userPosts = +currentDd.text().replace('Příspěvky: ', '');
            currentDd = currentDd.next();
            post.userRegistered = parse_date(currentDd.text().replace('Registrován: ', ''));
            if (post.phpbbid) {
                sd.posts.push(post);
            }
        });

        if (sd.phpbbid === null) {
            // sd.meta.status = 'No topic found at "'+sd.url+'"';
            // sd.meta.statusCode = 404;
        }
    }

    scrapUser(sd) {
        debug('this.scrapUser()');
        const $ = sd.$;
        const user = sd.user;
        sd.phpbbid = Scrapper.userIdFromUrl(sd.url);
        sd.title = $('dl.details').first().children('dd').children('span').text();
        if (sd.title.length === 0) {
            sd.meta.status = 'No user found at "'+sd.url+'"';
            sd.meta.statusCode = 404;
            return;
        }
        user.signature = $('.signature').html();

        const userBody = $('form#viewprofile').children('div.panel');
        const userBodyPanel1 = userBody.first().children('div.inner').children('dl');
        user.avatar = userBodyPanel1.first().children('dt').children('img').first().attr('src');
        if (user.avatar && user.avatar.length > 0) {
            user.avatar = user.avatar.replace(/^\.\//, '/');
        }
        if (!userBodyPanel1.first().hasClass('details')) {
            user.rank = userBodyPanel1.first().children('dd').text();
            if (user.rank.length === 0) {
                user.rank = null;
            }
        }
        let detailsBody = userBodyPanel1.first();
        if (user.avatar) {
            detailsBody = detailsBody.next();
        }
        detailsBody.children('dt').each((i, e) => {
            const dd = $(e).next();
            switch ($(e).text()) {
                case 'Uživatelské jméno:':
                    user.username = dd.children('span').text();
                    user.color = color_from_style(dd.children('span'));
                    break;
                case 'Bydliště:':
                    user.address = dd.text();
                    break;
                case 'Věk:':
                    user.age = dd.text();
                    break;
                case 'Skupiny:':
                    dd.children('select').children('option').each((j, o) => {
                        const option = $(o);
                        const groupId = option.attr('value');
                        const groupUrl = this.makeGroupUrl(sd, groupId)
                        const group = {
                            phpbbid: groupId,
                            urlBased: groupUrl,
                            url: this.unbase(groupUrl),
                            title: option.text()
                        };
                        if (option.attr('selected') === 'selected') {
                            user.defaultGroup = group;
                        }
                        user.groups[groupId] = group;
                    });
                    break;
                case 'Profese:':
                    user.profession = dd.text();
                    break;
                case 'Zájmy:':
                    user.interests = dd.text();
                    break;
                case 'Povolání:':
                    user.occupation = dd.text();
                    break;
                case 'Zobrazit bydliště na mapě:':
                    user.showOnMap = (dd.text() === 'Ano');
                    break;
                case 'Hodnost:':
                    user.rank = dd.text();
                    break;
            }
        });
        const userBodyPanel2 = userBody.first().next().children('div.inner');
        userBodyPanel2.children('div.column1').children('dl.details').children('dt').each((i, e) => {
            const dd = $(e).next();
            switch ($(e).text()) {
                case 'ICQ:':
                    user.icq = dd.children('a').attr('href')
                        .replace(/http:\/\/www\.icq\.com\/people\//, '')
                        .replace(/\//, '');
                    break;
                case 'WWW:':
                    user.www = dd.children('a').attr('href');
                    break;
                case 'Jabber:':
                    user.jabber = dd.text();
                    break;
            }
        });
        userBodyPanel2.children('div.column2').children('dl.details').children('dt').each((i, e) => {
            const dd = $(e).next();
            switch ($(e).text()) {
                case 'Registrován:':
                    user.registered = parse_date(dd.text());
                    break;
                case 'Poslední návštěva:':
                    user.lastVisit = (dd.text() === ' - ') ? null : parse_date(dd.text());
                    break;
                case 'Celkem příspěvků:':
                    user.totalPosts = +dd.text().split(/\n/).shift().replace(/ .*$/m, '');
                    break;
            }
        });
        let likesBody = userBody.first();
        let check = null;

        for(let i = 0; i < likesBody.siblings().length - 1; i++) {
            likesBody = likesBody.next();
            check = likesBody.children('div.inner').children('h3').text();
            if (check === 'Poděkování') {
                user.likesGave = +likesBody
                    .children('div.inner').children('dl').children('dt').text()
                    .replace(/Dal poděkování: /, '')
                    .replace(/ krát/, '');
                user.likesGot = +likesBody.next()
                    .children('div.inner').children('dl').children('dt').text()
                    .replace(/Dostal poděkování: /, '')
                    .replace(/ krát/, '');
                break;
            }

        }
        sd.user = user;
    }

    scrapGroup(sd) {
        debug('this.scrapGroup() "%s"', sd.url.href);
        const $ = sd.$;
        sd.phpbbid = Scrapper.groupIdFromUrl(sd.url);
        const title = $('h2');
        sd.title = title.text();
        sd.color = color_from_style(title);
        $('div.inner').children('table.table1').each((i, p) => {
            const table = $(p);
            table.children('tbody').children('tr').each((i, e) => {
                const user = {
                    phpbbid: null,
                    url: null,
                    username: null,
                    rank: null,
                    nPosts: null,
                    registered: null
                };
                let td = $(e).children('td').first();
                const userLink = td.children('a');
                user.urlBased = userLink.attr('href');
                user.url = this.unbase(user.urlBased);
                user.username = userLink.text();
                user.rank = td.children('span').text();
                user.color = color_from_style(userLink);
                user.phpbbid = Scrapper.userIdFromUrl(user.urlBased);
                td = td.next();
                user.nPosts = td.children('a').text();
                td = td.next().next();
                user.registered = parse_date(td.text());
                if (table.attr('id') === 'memberlist') {
                    user.moderator = true;
                }
                sd.users[user.phpbbid] = user;
            });
        });
    }

    scrapPagination(sd) {
        debug('this.scrapPagination()');
        const $ = sd.$;
        const pagination = $('.pagination > a > strong');
        sd.navi.page = +pagination.first().text();
        sd.navi.pages = +pagination.last().text();
        if (sd.navi.page > 0) {
            const tempUrl = new URL(sd.url);
            tempUrl.searchParams.delete('start');
            sd.navi.firstBased = tempUrl;
            sd.navi.first = this.unbase(tempUrl);
            sd.navi.pagerBased = new URL(sd.navi.firstBased);
            sd.navi.pageElements = 100;
            if (sd.typeId === PageType.Topic ||
                sd.typeId === PageType.UserPosts) {
                sd.navi.pageElements = 10;
            }
            sd.navi.pagerBased.searchParams.set('start', (sd.navi.pageElements+''));
            sd.navi.pagerBased = sd.navi.pagerBased.href.replace('start=1', 'start={PAGE}');
            sd.navi.pager = this.unbase(sd.navi.pagerBased);

            if (sd.navi.page === 2) {
                sd.navi.prevBased = sd.navi.firstBased;
            } else {
                if (sd.navi.page > 2) {
                    sd.navi.prevBased = sd.navi.pagerBased.replace('{PAGE}', sd.navi.page - 2);
                }
            }
            sd.navi.prev = this.unbase(sd.navi.prevBased);
            if (sd.navi.page < sd.navi.pages) {
                sd.navi.nextBased = sd.navi.pagerBased.replace('{PAGE}', sd.navi.page);
            }
            sd.navi.next = this.unbase(sd.navi.nextBased);
            sd.navi.lastBased = sd.navi.pagerBased.replace('{PAGE}', sd.navi.pages - 1);
            sd.navi.last = this.unbase(sd.navi.lastBased);
        }
    }

    scrapPoll(sd) {
        debug('this.scrapPoll()');
        const $ = sd.$;
        const poll = {
            title: $('div.panel > div.inner > div.content > h2').text(),
            nVoters: 0,
            nVotes: 0,
            options: [],
        };
        if (poll.title && poll.title.length > 0) {
            const pollBody = $('fieldset.polls > dl');
            pollBody.each((i, p) => {
                const optionBody = $(p);
                const resultLink = $(p).find('dd.resultbar > a');
                if (resultLink.length > 0) {
                    poll.resultsUrlBased = resultLink.attr('href');
                    poll.resultsUrl = this.unbase(resultLink.attr('href'));
                } else {
                    const inputTag = $(p).find('dd.resultbar > input');
                    if (inputTag.length === 0) {
                        const option = {
                            text: $(p).find('dt').text(),
                            votes: $(p).find('dd.resultbar').text(),
                            percents: $(p).find('dd').last().text().replace('%', ''),
                        };
                        option.percentsVoters = option.percents;
                        const numbersRegExp = /Celkem hlasujících : (\d+) - Celkem hlasů : (\d+)/;
                        const matches = numbersRegExp.exec(option.votes);
                        if (matches && matches.length > 0) {
                            poll.nVoters = +matches[1];
                            poll.nVotes = +matches[2];
                        } else {
                            option.votes = +option.votes;
                            option.percents = +option.percents || 0;
                            option.percentsVoters = option.percents || 0;
                            poll.options.push(option);
                        }
                    }
                }
            });

            if (poll.nVotes > poll.nVoters) {
                const percent = poll.nVoters / 100;
                for (let i = 0; i < poll.options.length; i++) {
                    poll.options[i].percentsVoters = Math.round(poll.options[i].votes / percent);
                }
            }
        }
        sd.poll = poll;
    }

    unbase (url) {
        if (!url) return null;
        if (typeof url !== 'string') {
            url = url.href;
        }
        return url.replace(new RegExp('^('+this.baseOrigin+'|'+this.base+')'), '');
    }

    normalizeLinks (text) {
        if (text && text.length > 0) {
            return text
                .replace(new RegExp(this.baseOrigin, 'g'), this.base)
                .replace(new RegExp('https://ipx.pirati.cz/http', 'g'), 'http')
        }
        return null;
    }

    makeGroupUrl(sd, group_id) {
        const groupUrl = new URL(sd.url);
        groupUrl.pathname = '/memberlist.php';
        groupUrl.search = '';
        groupUrl.searchParams.set('mode', 'group');
        groupUrl.searchParams.set('g', group_id);
        return groupUrl;
    }

    convertCreatedDate(authorBody, $) {
        const createdBody = authorBody.clone();
        createdBody.children().each((i, e) => {
            $(e).remove();
        });
        return parse_date(createdBody.text().replace(/od  » /, ''));
    }

    static linkType (url, rewrite = false) {
        if (rewrite) {
            url = Scrapper.rewrite(url);
        }
        if (typeof url === 'string') {
            try {
                // if just url pathname, add "dummy" protocol and hostname
                if (!/^https?:\/\//.exec(url)) {
                    url = 'http://dummy/' + url;
                }
                url = new URL(url);
            } catch (err) {
                debug('url parse error: "%s" "%o"', url, err);
                url = null;
            }
        }
        if (!url) {
            return PageType.None;
        }
        switch (url.pathname) {
            case '/':
                return PageType.Root;
            case '/viewforum.php':
                return PageType.Forum;
            case '/viewtopic.php':
                return PageType.Topic;
            case '/memberlist.php':
                const mode = url.searchParams.get('mode');
                return mode === 'viewprofile' ? PageType.User :
                    (mode === 'group' ? PageType.Group :  PageType.MemberList);
            case '/search.php':
                const search_id = url.searchParams.get('search_id');
                const author_id = url.searchParams.get('author_id');
                const sr = url.searchParams.get('sr');
                return search_id === 'active_topics' ?
                    PageType.ActiveTopics :
                    (search_id === 'unanswered' ?
                        PageType.Unanswered :
                        (author_id > 0 ?
                            (sr === 'posts' ?
                                PageType.UserPosts :
                                PageType.UserTopics) :
                            PageType.Search));
            case '/download/file.php':
                return PageType.Resource;
            default:
                if (/^\/(.+\/)?(styles\/.*|images\/.*)/.exec(url.pathname)) {
                    return PageType.Static;
                }

                return PageType.None;
        }
    }

    static isCacheable(pageType) {
        const cacheableTypes = [
            PageType.Root,
            PageType.Forum,
            PageType.Topic,
            PageType.User
        ];
        return (cacheableTypes.indexOf(pageType) !== -1);
    }

    static rewrite(url) {
        // debug('rewrite? "%o"', url);
        url = normalize_url(url);
        // debug('normalized "%o"', url);
        const rules = rewriteRules;
        for (let i = 0; i < rules.length; i++) {
            const regexp = rules[i][0];
            const replace = rules[i][1];
            // debug('check "%o" ~ "%o"', url.pathname, regexp);
            const matches = regexp.exec(url.pathname);
            if (matches) {
                // debug('matches! "%s" <= "%o"', replace, matches);
                const parts = replace_matches(replace, matches).split('?');
                url.pathname = parts[0];
                url.search = parts[1] || '';
                // debug('URL rewritten: "%s"', url);
                return url;
            }
        }
        return url;
    }

    static getPageFromUrl(url, typeId = null) {
        let elementsPerPage = 10;
        if (!typeId) {
            typeId = Scrapper.linkType(url);
        }
        if (typeId === PageType.Topic) {
            elementsPerPage = 100;
        }
        const start = get_query_param_from_url(url, 'start', true);
        return start ? (start / elementsPerPage) : 0;
    }

    static getIdFromUrl(url, typeId = null) {
        if (!typeId) {
            typeId = Scrapper.linkType(url);
        }
        switch(typeId) {
            case PageType.Root:
                return 0;
            case PageType.Forum:
                return Scrapper.forumIdFromUrl(url);
            case PageType.Topic:
                return Scrapper.topicIdFromUrl(url);
            case PageType.Group:
                return Scrapper.groupIdFromUrl(url);
            case PageType.User:
                return Scrapper.userIdFromUrl(url);
        }
        return null;
    }

    static parseForumUrl(url, typeId = null) {
        url = normalize_url(url);
        if (!typeId) {
            typeId = Scrapper.linkType(url);
        }
        debug('parseForumUrl');
        debug(url, typeId);
        const meta = {
            typeId: typeId,
            phpbbid: Scrapper.getIdFromUrl(url, typeId),
            page: Scrapper.getPageFromUrl(url, typeId),
        };
        if (meta.page >= 0) {
            meta.page++;
        }
        debug('Parsed type, id and page from url "%s" to "%o"', url, meta);
        return meta;
    }

    static forumIdFromUrl(url) {
        const f = get_query_param_from_url(url, 'f', true);
        if (f) {
            return f;
        } else {
            const forumUri = get_query_param_from_url(url, 'forum_uri');
            if (forumUri) {
                return Scrapper.forumIdFromUrl(forumUri);
            }
            return null;
        }
    }

    static topicIdFromUrl(url) {
        return get_query_param_from_url(url, 't', true);
    }

    static userIdFromUrl(url) {
        return get_query_param_from_url(url, 'u', true);
    }

    static groupIdFromUrl(url) {
        return get_query_param_from_url(url, 'g', true);
    }

    static postIdFromUrl(url) {
        return get_query_param_from_url(url, 'p', true);
    }

    static postIdFromUrlHash(url) {
        debug('postIdFromUrlHash "%o"', url);
        url = Scrapper.rewrite(url);
        return +first_match(url.hash, /#p(\d+)$/);
    }

}

function cheerio_load_or_reject(body, reject, message = null) {
    try {
        return cheerio.load(body);
    } catch (err) {
        if (message) {
            debug(message, err, body);
        }
        reject(err);
        return false;
    }
}

function reject_on_request_error(err, body, reject) {
    if (!err && (!body || (body.length && body.length === 0))) {
        err = new Error('no content');
    }
    if (err) {
        debug('rejecting on request error: "%o"', err);
        reject(err);
        return true;
    }
    return false;
}

function czech_short_month(m) {
    return {
        'led': '01',
        'úno': '02',
        'bře': '03',
        'dub': '04',
        'kvě': '05',
        'čer': '06',
        'črc': '07',
        'srp': '08',
        'zář': '09',
        'říj': '10',
        'lis': '11',
        'pro': '12'
    }[m];
}

function parse_date(date) {
    if (!date) {
        return null;
    }
    const c = date.split(/ /);
    if (c.length > 2) {
        return c[2].replace(',', '') + '-' + czech_short_month(c[1]) + '-' + c[0] + ' ' + c[3];
    }
    return null;
}

function color_from_style($) {
    const style = $.attr('style');
    const regexp = /color:\s*(#[0-9a-fA-F]{1,6})/;
    if (style) {
        return first_match(style, regexp);
    }
    return null;
}

function nth_match(text, re, n = 1) {
    const matches = re.exec(text);
    if (matches && matches[n]) {
        return matches[n];
    }
    return null
}

function first_match(text, re) {
    return nth_match(text, re, 1);
}

function replace_matches(replace, matches) {
    for(let i = 0; i < matches.length; i++) {
        const re = new RegExp('\\$'+i, 'g');
        // debug('replacing "%o" by "%s" at "%s', re, matches[i], replace);
        replace = replace.replace(re, matches[i] || '');
    }
    return replace;
}

function normalize_url(url) {
    if (typeof url === 'string') {
        try {
            url = new URL(url);
        } catch (err) {
            debug('normalize_url parse error: "%s" "%o"', url, err);
            url = null;
        }
    }
    return url;
}

function get_query_param_from_url(url, param, onlyNonZero = false) {
    // debug('---', url, param, onlyNonZero, '---');
    url = Scrapper.rewrite(url);
    let value = url.searchParams.get(param);
    if (onlyNonZero) {
        value = +value;
        if (value > 0) {
            return value;
        }
        value = null;
    }
    if (value === '') {
        value = null;
    }
    return value;
}

Scrapper.request = jarredRequest;
Scrapper.jsonVersion = jsonVersion;
Scrapper.PageType = PageType;
Scrapper.rewriteRules = rewriteRules;
module.exports = Scrapper;


/*
storeResource(url, response) {
    return new Promise((resolve, reject) => {
        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];
        let filePath = null;
        const avatar = url.searchParams.get('avatar');
        if (avatar && avatar.length > 0) {
            debug('avatar: %o', avatar);
            const matches = /^(g)?(\d+)(_(\d+))?\.(gif|png|jpg|jpeg)$/.exec(avatar);
            if (matches) {
                const g = matches[1] || '';
                const uid = matches[2];
                const stamp = matches[4];
                const ext = matches[5];
                filePath = '/avatars/' + g + uid + '.' + ext;
                debug('filePath: "%s" stamp: "%s"', filePath, stamp);
            }
        }
        if (filePath) {
            filePath = join(this.dataDir, filePath);
            debug('filePath: "%s"', filePath);
            const fileStream = fs.createWriteStream(filePath);
            response
                .pipe(fileStream)
                .on('end', () => {
                    debug('on end');
                    resolve(filePath, contentType, contentLengt);
                })
                .on('error', (err) => {
                    debug('on error');
                    debug('Resource store error: "%o"', err);
                    reject(err);
                });
            debug('piping response to file...');
        } else {
            debug('Resource Unknown "%s"', url);
            reject(new Error('resource unknown + ', url))
        }
    });
}
*/
