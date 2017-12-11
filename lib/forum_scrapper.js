"use strict";

const debug = require('debug')('forum-scrapper');
const fnDebug = require('debug')('fn:forum-scrapper');

const removeDiacritics = require('diacritics').remove;
const cheerio = require('cheerio');
const origRequest = require('request');
const URL = require('url');

const requestExt = require('request-extensible');
const RequestHttpCache = require('request-http-cache');

const PageType = {
    None: '0',
    Root: '1',
    Forum: '2',
    Thread: '3',
    Group: '4',
    User: '5',
    Search: '6',
    Unanswered: '7',
    ActiveTopics: '8',
    UserPosts: '9',
    UserTopics: '10',
    MemberList: '11',
};

const urlMatchType = {
     3: /\/.*((topic|post|-t)(\d+)?(-\d+)?\.html|viewtopic.php)(\?.*)?(#.*)?$/,
     2: /\/.*-f(\d+)\/?(page(\d+).html)?(\?.*)?(#.*)?$/,
     6: /\/search\.php(\?.*)?(#.*)?$/,
     5: /\/.*-u(\d+)\/?(\?.*)?(#.*)?$/,
     9: /\/.*-u(\d+)\/posts\/?(page(\d+)\.html)?(\?.*)?(#.*)?$/,
    10: /\/.*-u(\d+)\/topics\/?(page(\d+)\.html)?(\?.*)?(#.*)?$/,
     4: /\/.*-g(\d+)(-\d+)?.html(\?.*)?(#.*)?$/,
    11: /\/memberlist(-\d+)?\.php(\?.*)?(#.*)?$/,
     8: /\/active-topics(-(\d+))?\.html(\?.*)?(#.*)?$/,
     7: /\/unanswered(-(\d+))?\.html(\?.*)?(#.*)?$/,
};

const defaultRequest = origRequest.defaults({ jar: true, timeout: 500 });

class ForumScrapper {

    constructor(url, base, originBase, requestCache) {
        this.status = 'OK';
        this.statusCode = 200;
        this.phpbbid = null;
        this.title = null;
        this.url = url;
        this.type = null;
        this.typeid = null;
        this.base = base;
        this.originBase = originBase;
        this.unbased = null;
        this.mirrorUrl = null;
        this.asJson = null;

        this.navi = {
            page: null,
            pages: null,
            pagerUrl: null,
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
            avatarSrc: null,
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

        this.poll = null;
        this.users = {};
        this.sections = {};
        this.forums = {};
        this.announcements = {};
        this.threads = {};
        this.posts = [];
        this.moderators = { users: [], groups: [] };

        this.map = {
            PageType: PageType,
        };
        this.color = null;
        this.rules = null;
        this.keywords = null;
        this.links = [];

        // object (non-JSON) properties
        this.$ = null;
        this.httpRequestCache = null;
        this.defaultRequest = null;
        this.request = null;
        this.requestCache = requestCache;
    }

    static linkType(url) {
        if (!url || url === '') return PageType.None;
        const keys = Object.keys(urlMatchType);
        for (let i = 0; i < keys.length; i++) {
            const type = keys[i];
            if (urlMatchType.hasOwnProperty(type)) {
                if (urlMatchType[type].exec(url)) {
                    // debug('%d = %s', type, url);
                    return type;
                }
            }
        }
        if (/^(https?:\/\/[^\/]+)?\/(index.php)?(\?.*)?(#.*)?$/.exec(url)) {
            return PageType.Root;
        }
        return PageType.None;
    }

    static cacheableType(type) {
        return [
            PageType.Root,
            PageType.Forum,
            PageType.Thread,
            PageType.Group,
            PageType.User
        ].indexOf(type) > -1
    }

    static scrap(url, base, originBase, requestCache) {
        return new Promise((resolve, reject) => {
            const scrapper = new ForumScrapper(url, base, originBase, requestCache);
            scrapper.scrap().then((data) => {
                data['mirrorUrl'] = data.url.replace(originBase, base);
                data.typeid = data.type;
                for (const t in PageType) {
                    if (PageType.hasOwnProperty(t) && PageType[t] === data.typeid) {
                        data.type = t
                    }
                }
                let properties = ['$', 'request', 'defaultRequest', 'httpRequestCache', 'map'];
                properties.forEach((prop) => {
                    delete data[prop];
                });
                if (data.user.username === null) {
                    data.user = null;
                }
                if (data.poll && (!data.poll.title || data.poll.title.length === 0)) {
                    data.poll = null;
                }
                const tempUrl = URL.parse(data.mirrorUrl, true);
                tempUrl.query.json = true;
                tempUrl.search = undefined;
                data['asJson'] = URL.format(tempUrl);
                resolve(data);
            }).catch((err) => {
                reject(err);
            });
        });
    }

    scrap() {
        // fnDebug('this.scrap()');
        this.type = ForumScrapper.linkType(this.url);
        return new Promise((resolve, reject) => {
            let scrappingRequest = defaultRequest;
            if (this.requestCache) {
                if (!this.request) this.initCache();
                scrappingRequest = this.request;
            }
            scrappingRequest({
                url: this.url
            }, (err, response, body) => {
                if (err) {
                    debug('scrap request error %o', err);
                    reject(err);
                    return;
                }
                if (!body) {
                    debug('scrap request error no content');
                    reject('no content');
                    return;
                }
                try {
                    this.$ = cheerio.load(body);
                } catch (err) {
                    debug('scrap cheerio parsing body: %s\n#####\n%s\n#####', this.url, body);
                    debug('scrap cheerio parsing error: %o', err);
                    reject(err);
                    return;
                }
                // debug('type: %d', this.type);
                switch (this.type) {
                    case PageType.Root:
                        this.title = this.$('title').text();
                    case PageType.Forum:
                    case PageType.Unanswered:
                    case PageType.ActiveTopics:
                    case PageType.UnreadPosts:
                    case PageType.UserTopics:
                        this.scrapForum();
                        break;
                    case PageType.Search:
                        const query = URL.parse(this.url, true).query;
                        if (query['keywords']) {
                            this.keywords = query.keywords;
                        }
                        this.scrapThread();
                        break;
                    case PageType.UserPosts:
                    case PageType.Thread:
                        this.scrapThread();
                        break;
                    case PageType.User:
                        this.scrapUser();
                        break;
                    case PageType.MemberList:
                    case PageType.Group:
                        this.scrapGroup();
                        break;
                }
                this.scrapLinks();
                this.scrapParent();
                this.scrapPagination();
                this.$ = null;
                this.unbased = this.unbase(this.url);
                setTimeout(() => {
                    resolve(this);
                }, 100);
            });
        });
    }

    static scrapPost(url) {
        fnDebug('ForumScrapper.scrapPost("%s")', url);
        return new Promise((resolve, reject) => {
            defaultRequest({
                url: url
            }, (err, response, body) => {
                if (err) {
                    debug('scrap post request error %o', err);
                    reject(err);
                    return;
                }
                if (!body) {
                    debug('scrap post request error no content');
                    reject('no content');
                    return;
                }
                let $;
                try {
                    $ = cheerio.load(body);
                } catch (err) {
                    debug('scrap post cheerio parsing body: %s\n#####\n%s\n#####', this.url, body);
                    debug('scrap post cheerio parsing error: %o', err);
                    reject(err);
                    return;
                }
                const regexp_quote_open = new RegExp('^\\[url[^\\]]+\\][^\\[]*\\[/url\\]\\s+\\[quote="[^"]+"\\]', 'm');
                const regexp_quote_close = new RegExp('\\[\/quote\\]\\n$', 'm');
                const content = $('#message').text().replace(regexp_quote_open, '').replace(regexp_quote_close, '');
                // debug('CONTENT: "%s"', content);
                setTimeout(() => {
                    resolve(content);
                }, 100);
            });
        });

    }


    scrapRules() {
        // fnDebug('this.scrapRules()');
        this.rules = this.$('div.rules').children('div.inner').html();
        if (this.rules && this.rules.length > 0) {
            this.rules = this.rules.replace(this.originBase, this.base);
        }
        return this.rules;
    }

    scrapLinks() {
        // fnDebug('this.scrapLinks()');
        this.$('a').each((i, a) => {
            const linkUrl = this.unbase(this.$(a).attr('href'));
            const type = ForumScrapper.linkType(this.$(a).attr('href'));
            if ((linkUrl || typeof linkUrl === typeof 'string') && type !== PageType.None) {
                this.links.push({
                    title: this.$(a).text(),
                    originUrl: this.$(a).attr('href'),
                    url: linkUrl.replace(/#wrap$/, ''),
                    type: type
                });
            }
        });
    }

    scrapParent() {
        // fnDebug('this.scrapParent()');
        const linkPath = this.$('div#page-header').children('div.navbar').children('div.inner').children('ul.navlinks')
            .children('li.icon-home').children('a');
        this.navi.forum = this.unbase(linkPath.last().attr('href'));
        this.navi.forumTitle = linkPath.last().text();
        if (linkPath.length > 1) {
            this.navi.parent= this.unbase(linkPath.last().prev().prev().attr('href'));
            this.navi.parentTitle = linkPath.last().prev().prev().text();
        }
    }

    scrapLastPost(p) {
        let lastPost = {
            username: null,
            user: null,
            post: null,
            created: null
        };
        p.children('span').children('a').each((i, p) => {
            const lastPostUrl = this.unbase(this.$(p).attr('href'));
            const urlType = ForumScrapper.linkType(lastPostUrl);
            // debug('lastPostUrl: "%s" (%d)', lastPostUrl, urlType);
            if (urlType === PageType.User) {
                lastPost.user = lastPostUrl;
                lastPost.username = this.$(p).text();
                lastPost.user_color = ForumScrapper.colorFromStyle(this.$(p));
            } else {
                if (urlType === PageType.Thread) {
                    lastPost.post = lastPostUrl;
                }
            }
        });
        if (!lastPost.user) {
            lastPost.username = p.children('span').children('span').text();
            lastPost.user = 'unregistered:'+lastPost.username;
        }
        if (lastPost.post) {
            const lastPostTime = p.children('span').text().split(/\n/);
            lastPost.created = ForumScrapper.parseDate(lastPostTime[lastPostTime.length-1].trim());
        } else {
            lastPost = null;
        }
        return lastPost;
    }

    static scrapRowPages(body) {
        const pages = +body.children('strong.pagination').children('span').children('a').last().text();
        return pages === 0 ? 1 : pages;
    }

    scrapForum() {
        fnDebug('this.scrapForum()');
        this.scrapRules();
        this.phpbbid = ForumScrapper.forumIdFromUrl(this.url);
        const title = this.$('div#page-body').children("h2").text();
        if (title) {
            this.title = title;
        }
        let section = null;
        let sectionIndex = -1;
        this.$('.topiclist').each((i, p) => {
            if (this.$(p).hasClass('topics')) {
                // debug('topic section', i);
                this.$(p).children('li').each((i, p) => {
                    const dl = this.$(p).children('dl');
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
                        if (this.$(p).hasClass('topictitle')) {
                            topicLink = this.$(p);
                            topicUrl = this.unbase(topicLink.attr('href'));
                            topicTitle = topicLink.text();
                        } else {
                            const url = this.unbase(this.$(p).attr('href'));
                            if (ForumScrapper.linkType(url) === PageType.User) {
                                opUrl = url;
                                opUsername = this.$(p).text();
                                opColor = ForumScrapper.colorFromStyle(this.$(p));
                            } else {
                                if (ForumScrapper.linkType(url) === PageType.Forum) {
                                    fUrl = url;
                                    fTitle = this.$(p).text();
                                }
                            }
                        }
                    });
                    if (opUrl === '') {
                        opUsername = topicBody.children('span').text();
                        opUrl = 'unregistered:'+opUsername;
                        opColor = ForumScrapper.colorFromStyle(topicBody.children('span'));
                    }
                    const op = topicBody.text();
                    const created = ForumScrapper.parseDate(op.replace(/^[\s\S]*» /, '').replace(/\n[\s\S]*$/, ''));
                    const nPosts = dl.children('dd.posts').text().split(' ').shift()*1;
                    const nViews = dl.children('dd.views').text().split(' ').shift()*1;
                    const lastPost = this.scrapLastPost(dl.children('dd.lastpost'));

                    const topic = {
                        phpbbid: ForumScrapper.threadIdFromUrl(topicUrl),
                        url: topicUrl,
                        title: topicTitle,
                        locked: (dl.attr('style').match(/locked.gif/) !== null),
                        pages: ForumScrapper.scrapRowPages(topicBody),
                        created: created,
                        user: opUrl,
                        username: opUsername,
                        user_color: opColor,
                        forum: fUrl,
                        forumTitle: fTitle,
                        n_posts: nPosts,
                        n_views: nViews,
                        last_post: lastPost,
                        section: sectionIndex,
                    };
                    if (this.$(p).hasClass('global-announce')) {
                        this.announcements[topic.phpbbid] = topic;
                        this.sections[sectionIndex].announcements.push(topic.phpbbid);
                    } else {
                        this.threads[topic.phpbbid] = topic;
                        this.sections[sectionIndex].threads.push(topic.phpbbid);
                    }
                })
            } else {
                if (this.$(p).hasClass('forums')) {
                    // debug('forum section', i);
                    this.$(p).children('li').each((i, p) => {
                        const dl = this.$(p).children('dl');
                        const forumBody = dl.children('dt');
                        const forumLinks = forumBody.children('a');
                        let forumUrl = '';
                        let forumTitle = '';
                        const subforums = [];
                        const moderators = [];
                        forumLinks.each((i, p) => {
                            const link = this.$(p);
                            if (link.hasClass('forumtitle')) {
                                forumUrl = this.unbase(link.attr('href'));
                                forumTitle = link.text();
                            } else {
                                const linkObj = {
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

                        const nTopics = dl.children('dd.topics').text().split(' ').shift()*1;
                        const nPosts = dl.children('dd.posts').text().split(' ').shift()*1;
                        const lastPost = this.scrapLastPost(dl.children('dd.lastpost'));

                        const forum = {
                            phpbbid: ForumScrapper.forumIdFromUrl(forumUrl),
                            url: forumUrl,
                            title: forumTitle,
                            locked: (dl.attr('style').match(/locked.gif/) !== null),
                            pages: ForumScrapper.scrapRowPages(forumBody),
                            n_topics: nTopics,
                            n_posts: nPosts,
                            last_post: lastPost,
                            section: section.id,
                            subforums: subforums,
                            moderators: moderators
                        };
                        this.forums[forum.phpbbid] = forum;
                        this.sections[sectionIndex].forums.push(forum.phpbbid);
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
                        threads: [],
                    };
                    const sectionBody = this.$(p).children('li').children('dl').children('dt');
                    const sectionLink = sectionBody.children('a');
                    if (sectionLink.length > 0) {
                        section.url = this.unbase(sectionLink.attr('href'));
                        section.title = sectionLink.text();
                    } else {
                        section.title = sectionBody.text();
                    }
                    this.sections[sectionIndex] = section;
                }
            }
        });
    }

    scrapThread() {
        fnDebug('this.scrapThread()');
        this.scrapRules();
        this.scrapPoll();
        this.phpbbid = ForumScrapper.threadIdFromUrl(this.url);
        this.title = this.$('div#page-body').children("h2").text();

        let moderatorsBody = this.$('div#page-body').children('p').first();
        if (moderatorsBody.children('strong') === 0) {
            moderatorsBody = moderatorsBody.next();
        }
        if (moderatorsBody.length > 0) {
            moderatorsBody.children('a').each((i, p) => {
                const moderator = {
                    url: this.unbase(this.$(p).attr('href')),
                    title: this.$(p).text()
                };
                moderator.color = ForumScrapper.colorFromStyle(this.$(p));
                const type = ForumScrapper.linkType(moderator.url);
                if (type === PageType.Group) {
                    this.moderators.groups.push(moderator);
                } else {
                    if (type === PageType.User) {
                        this.moderators.users.push(moderator);
                    } else {
                        debug('unknown moderator type url: "%s"', moderator.url);
                    }
                }
            });
        }

        this.$('.post').each((i, p) => {
            const postBody = this.$(p).children('div.inner').children('div.postbody');
            const postProfileBody = this.$(p).children('div.inner').children('dl.postprofile');
            const titleLink = postBody.children('h3').children('a');
            let authorBody = postBody.children('p.author');
            let authorLink;
            let authorUrl;
            let authorName;
            let authorColor;
            let avatarSrc;
            let created;
            let likes;

            if (authorBody.length > 0) {
                const authorLink = authorBody.children('strong').children('a');
                const likesBody = postBody.children('div.content').last().children('dl.postbody').children('dd').children('a');
                likes = [];
                likesBody.each((j, a) => {
                    likes.push({
                        user: this.unbase(this.$(a).attr('href')),
                        username: this.$(a).text(),
                        user_color: ForumScrapper.colorFromStyle(this.$(a)),
                    });

                });
                created = this.convertCreatedDate(authorBody);
                authorUrl = this.unbase(authorLink.attr('href'));
                authorName = authorLink.text();
                authorColor = ForumScrapper.colorFromStyle(authorLink);
                if (!authorUrl) {
                    authorName = authorBody.children('strong').children('span').text();
                    authorUrl = 'unregistered:' + ForumScrapper.normalizeString(authorName);
                }
            }

            authorBody = postProfileBody.children('dt');
            authorLink = authorBody.children('a');
            avatarSrc = authorLink.children('img').attr('src');
            if (avatarSrc) {
                avatarSrc = avatarSrc.replace(/^\.\//, '/');
            }
            if (!authorName || !(authorName.length > 0)) {
                authorUrl = this.unbase(authorLink.attr('href'));
                authorName = authorLink.text();
                authorColor = ForumScrapper.colorFromStyle(authorLink);
            }
            if (authorBody.hasClass('author')) {
                created = this.convertCreatedDate(authorBody.next());
            }
            const profileFields = postProfileBody.children('dd');
            profileFields.first().text();

            const postUrl = titleLink.attr('href') || '';

            const post = {
                phpbbid: ForumScrapper.postIdFromUrlHash(titleLink.attr('href')),
                url: this.unbase(postUrl.replace(/\?[^#]*/, '')),
                title: titleLink.text(),
                user: this.rebase(authorUrl),
                username: authorName,
                user_color: authorColor,
                avatarSrc: avatarSrc,
                user_rank: null,
                user_posts:  null,
                user_registered: null,
                created: created,
                content: this.normalizeLinks(postBody.children('div.content').first().html()),
                signature: this.normalizeLinks(postBody.children('div.signature').first().html()),
                likes: likes
            };
            if (/\/post\d+\.html/.exec(this.url)) {
                this.url = titleLink.attr('href').replace(/#[^#]*/, '');
            }
            let currentDd = profileFields.first();
            let currentText = currentDd.text().trim();
            if (currentText !== '') {
                post.user_rank = currentText;
                currentDd = currentDd.next();
            }
            currentDd = currentDd.next();
            post.user_posts = +currentDd.text().replace('Příspěvky: ', '');
            currentDd = currentDd.next();
            post.user_registered = ForumScrapper.parseDate(currentDd.text().replace('Registrován: ', ''));
            if (post.phpbbid) {
                this.posts.push(post);
            }
        });
    }

    scrapUser() {
        fnDebug('this.scrapUser()');
        const user = this.user;
        this.phpbbid = ForumScrapper.userIdFromUrl(this.url);
        this.title = this.$('dl.details').first().children('dd').children('span').text();
        if (this.title.length === 0) {
            this.status = 'No user found at "'+this.url+'"';
            this.statusCode = 404;
            return;
        }
        user.signature = this.$('.signature').html();

        const userBody = this.$('form#viewprofile').children('div.panel');
        const userBodyPanel1 = userBody.first().children('div.inner').children('dl');
        user.avatarSrc = userBodyPanel1.first().children('dt').children('img').first().attr('src');
        if (user.avatarSrc && user.avatarSrc.length > 0) {
            user.avatarSrc = user.avatarSrc.replace(/^\.\//, '/');
        }
        user.rank = userBodyPanel1.first().children('dd').text();
        if (user.rank.length === 0) {
            user.rank = null;
        }
        let detailsBody = userBodyPanel1.first();
        if (user.avatarSrc) {
            detailsBody = detailsBody.next();
        }
        detailsBody.children('dt').each((i, e) => {
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
                case 'Uživatelské jméno:':
                    user.username = dd.children('span').text();
                    user.color = ForumScrapper.colorFromStyle(dd.children('span'));
                    break;
                case 'Bydliště:':
                    user.address = dd.text();
                    break;
                case 'Věk:':
                    user.age = dd.text();
                    break;
                case 'Skupiny:':
                    dd.children('select').children('option').each((j, o) => {
                        const option = this.$(o);
                        const id = option.attr('value');
                        const group = {
                            phpbbid: id,
                            url: this.unbase(this.makeGroupUrl(id, option.text())),
                            title: option.text()
                        };
                        if (option.attr('selected') === 'selected') {
                            user.defaultGroup = group;
                        }
                        user.groups[id] = group;
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
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
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
            const dd = this.$(e).next();
            switch (this.$(e).text()) {
                case 'Registrován:':
                    user.registered = ForumScrapper.parseDate(dd.text());
                    break;
                case 'Poslední návštěva:':
                    user.lastVisit = (dd.text() === ' - ') ? null : ForumScrapper.parseDate(dd.text());
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
        this.user = user;
    }

    scrapGroup() {
        fnDebug('this.scrapGroup()');
        this.phpbbid = ForumScrapper.groupIdFromUrl(this.url);
        this.title = this.$('h2').text();
        this.color = ForumScrapper.colorFromStyle(this.$('h2'));
        this.$('div.inner').children('table.table1').each((i, p) => {
            const table = this.$(p);
            table.children('tbody').children('tr').each((i, e) => {
                const user = {
                    phpbbid: null,
                    url: null,
                    username: null,
                    rank: null,
                    n_posts: null,
                    registered: null
                };
                let td = this.$(e).children('td').first();
                const userLink = td.children('a');
                user.url = this.unbase(userLink.attr('href'));
                user.username = userLink.text();
                user.rank = td.children('span').text();
                user.color = ForumScrapper.colorFromStyle(userLink)
                user.phpbbid = ForumScrapper.userIdFromUrl(user.url);
                td = td.next();
                user.n_posts = td.children('a').text();
                td = td.next().next();
                user.registered = ForumScrapper.parseDate(td.text());
                if (table.attr('id') === 'memberlist') {
                    user.moderator = true;
                }
                this.users[user.phpbbid] = user;
            });
        });
    }

    scrapPagination() {
        // fnDebug('this.scrapPagination()');
        const pagination = this.$('.pagination').children('a').children('strong');
        this.navi.page = +pagination.first().text();
        this.navi.pages = +pagination.last().text();
        if (this.navi.page > 0) {
            const tempUrl = URL.parse(this.url, true);
            tempUrl.query.start = undefined;
            tempUrl.search = undefined;
            this.navi.first = this.unbase(URL.format(tempUrl));
            this.navi.pageElements = 100;
            switch (this.type) {
                case PageType.UserPosts:
                    this.navi.first = this.unbase(this.url.replace(/\/?(page\d+\.html)?$/, '/'));
                    this.navi.pagerUrl = this.navi.first + 'page{PAGE}0.html';
                    this.navi.pageElements = 10;
                    break;
                case PageType.Forum:
                    this.navi.first = this.unbase(this.url.replace(/\/page\d+\.html$/, '/'));
                    this.navi.pagerUrl = this.navi.first + 'page{PAGE}00.html';
                    break;
                case PageType.Group:
                    this.navi.first = this.unbase(this.url.replace(/-\d+\.html$/, '.html'));
                    this.navi.pagerUrl = this.navi.first.replace(/\.html$/, '-{PAGE}00.html');
                    break;
                case PageType.Thread:
                    this.navi.first = this.unbase(this.url.replace(/-\d+\.html$/, '.html'));
                    this.navi.pagerUrl = this.navi.first.replace(/\.html$/, '-{PAGE}0.html');
                    this.navi.pageElements = 10;
                    break;
                default:
                    const tempUrl = URL.parse(this.navi.first, true);
                    tempUrl.query.start = 'STARTPAGER';
                    tempUrl.search = undefined;
                    this.navi.pagerUrl = URL.format(tempUrl).replace('STARTPAGER', '{PAGE}0' + (
                        this.type === PageType.ActiveTopics ||
                        this.type === PageType.Unanswered ||
                        this.type === PageType.MemberList
                        ? '0' : ''
                    ));
            }
            if (this.type === PageType.Thread) {
                this.navi.pageElements = 10;
            }
            if (this.navi.page === 2) {
                this.navi.prev = this.navi.first;
            } else {
                if (this.navi.page > 2) {
                    this.navi.prev = this.navi.pagerUrl.replace('{PAGE}', this.navi.page - 2);
                }
            }
            if (this.navi.page < this.navi.pages) {
                this.navi.next = this.navi.pagerUrl.replace('{PAGE}', this.navi.page);
            }
            this.navi.last = this.navi.pagerUrl.replace('{PAGE}', this.navi.pages-1);
        }
    }

    scrapPoll() {
        fnDebug('this.scrapPoll()');
        const poll = {
            title: this.$('div.panel').children('div.inner').children('div.content').children('h2').text(),
            n_voters: 0,
            n_votes: 0,
            options: [],
        };
        if (poll.title && poll.title.length > 0) {
            const pollBody = this.$('fieldset.polls').children('dl');
            pollBody.each((i, p) => {
                const optionBody = this.$(p);
                const resultLink = optionBody.children('dd.resultbar').children('a');
                if (resultLink.length > 0) {
                    poll.resultsUrl = this.rebase(resultLink.attr('href'));
                } else {
                    const inputTag = optionBody.children('dd.resultbar').children('input');
                    if (inputTag.length === 0) {
                        const option = {
                            text: optionBody.children('dt').text(),
                            votes: optionBody.children('dd.resultbar').text(),
                            percents: optionBody.children('dd').last().text().replace('%', ''),
                        };
                        option.percents_voters = option.percents;
                        const numbersRegExp = /Celkem hlasujících : (\d+) - Celkem hlasů : (\d+)/;
                        const matches = numbersRegExp.exec(option.votes);
                        if (matches && matches.length > 0) {
                            poll.n_voters = +matches[1];
                            poll.n_votes = +matches[2];
                        } else {
                            option.votes = +option.votes;
                            option.percents = +option.percents;
                            option.percents_voters = option.percents;
                            poll.options.push(option);
                        }
                    }
                }
            });

            if (poll.n_votes > poll.n_voters) {
                const percent = poll.n_voters / 100;
                for (let i = 0; i < poll.options.length; i++) {
                    poll.options[i].percents_voters = Math.round(poll.options[i].votes / percent);
                }
            }
        }
        this.poll = poll;
    }

    rebase(url) {
        if (!url) return null;
        return url.replace(new RegExp('^'+this.originBase), this.base);
    }

    unbase(url) {
        if (!url) return null;
        return url.replace(new RegExp('^('+this.originBase+'|'+this.base+')'), '');
    }

    normalizeLinks(text) {
        if (text && text.length > 0) {
            return text
                .replace(new RegExp(this.originBase, 'g'), this.base)
                .replace(new RegExp('https://ipx.pirati.cz/http', 'g'), 'http')
                .replace(new RegExp('src="images', 'g'), 'src="/images');

        }
        return null;
    }

    static normalizeString(s) {
        return removeDiacritics(s.toLowerCase().replace(/@/g, ''))
            .replace(/\s/g, '-').replace(/-+/g, '-');
    }

    makeGroupUrl(id, name) {
        if (id === 2) {
            name = 'registered';
        }
        const url = URL.parse(this.url);
        return url.protocol + '//' +
            url.host + '/' + ForumScrapper.normalizeString(name) +
            '-g' + id + '.html';
    }

    static parseForumUrl(url) {
        const meta = {
            typeid: ForumScrapper.linkType(url),
            phpbbid: null,
            page: null,
        };
        const normalizePage = (page, elements_per_page = 100) => {
            return page ? page/elements_per_page : 0;
        };
        switch(meta.typeid) {
            case PageType.Forum:
                meta.phpbbid = ForumScrapper.forumIdFromUrl(url);
                meta.page = normalizePage(ForumScrapper.firstMatch(url, /-f\d+\/page(\d+)\.html$/));
                break;
            case PageType.Thread:
                meta.phpbbid = ForumScrapper.threadIdFromUrl(url);
                meta.page = normalizePage(ForumScrapper.nthMatch(url, /(topic|post|-t)\d+-(\d+)\.html$/, 2), 10);
                break;
            case PageType.Group:
                meta.phpbbid = ForumScrapper.groupIdFromUrl(url);
                meta.page = normalizePage(ForumScrapper.firstMatch(url, /-g\d+-(\d+)\.html/));
                break;
            case PageType.User:
                meta.phpbbid = ForumScrapper.userIdFromUrl(url);
                break;
        }
        if (meta.page >= 0) {
            meta.page++;
        }
        // debug('Parsed type, id and page from url "%s" to "%o"', url, meta);
        return meta;
    }

    static firstMatch(text, re) {
        return ForumScrapper.nthMatch(text, re, 1);
    }

    static nthMatch(text, re, n = 1) {
        const matches = re.exec(text);
        if (matches && matches[n]) {
            return matches[n];
        }
        return null
    }

    static forumIdFromUrl(url) {
        return +ForumScrapper.firstMatch(url, /-f(\d+)\/?(page\d+\.html)?/);
    }

    static threadIdFromUrl(url) {
        return +ForumScrapper.nthMatch(url, /(topic|post|-t)(\d+)(-\d+)?\.html/, 2);
    }

    static userIdFromUrl(url) {
        return +ForumScrapper.firstMatch(url, /-u(\d+)\/?/);
    }

    static groupIdFromUrl(url) {
        return +ForumScrapper.firstMatch(url, /-g(\d+)(-\d+)?\.html/);
    }

    static postIdFromUrl(url) {
        return +ForumScrapper.firstMatch(url, /post(\d+)(-\d+)?\.html/);
    }

    static postIdFromUrlHash(url) {
        return +ForumScrapper.firstMatch(url, /#p(\d+)$/);
    }

    static month(m) {
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

    static parseDate(date) {
        if (!date) {
            return null;
        }
        const c = date.split(/ /);
        if (c.length > 2) {
            return c[2].replace(',', '') + '-' + ForumScrapper.month(c[1]) + '-' + c[0] + ' ' + c[3];
        }
        return null;
    }

    static colorFromStyle($) {
        const style = $.attr('style');
        const regexp = /color:\s*(#[0-9a-fA-F]{1,6})/;
        if (style) {
            return ForumScrapper.firstMatch(style, regexp);
        }
        return null;
    }

    convertCreatedDate(authorBody) {
        const createdBody = authorBody.clone();
        createdBody.children().each((i, e) => {
            this.$(e).remove();
        });
        return ForumScrapper.parseDate(createdBody.text().replace(/od  » /, ''));
    }

    initCache(httpRequestCache) {
        fnDebug('this.initCache(' + (httpRequestCache) ? 'injected httpRequestCache' : '' + ')');

        if (!httpRequestCache) {
            httpRequestCache = new RequestHttpCache({
                backend: 'redis',
                redis: {
                    host: '127.0.0.1',
                    port: '6379'
                },
                ttl: 86400
            });
        }
        ForumScrapper.httpRequestCache = httpRequestCache;

        const requestWithFakeResponseHeaders = (options, callback) => {
            defaultRequest(options, (error, response, body) => {
                /*
                              if (!error && response && response.headers) {
                                  response.headers.etag = (new Date(new Date().toJSON().slice(0, 10) + ' 00:00:00')).getTime();
                                  response.headers['pragma'] = '';
                                  response.headers['cache-control'] = "max-age=86400";
                                  response.headers['expires'] = Date.now() + 86400;
                              }
                               */
                callback(error, response, body);
            });
        };

        this.request = requestExt({
            request: requestWithFakeResponseHeaders,
//            extensions: [ForumScrapper.httpRequestCache.extension]
        });
    }

    static login(loginUrl, username, password) {
        fnDebug('ForumScrapper.login("%s", "%s", "%s")', loginUrl, username, '***invisible***');
        return new Promise((resolve, reject) => {
            if (!username || !password || !loginUrl) resolve(null);
            defaultRequest({
                url: loginUrl,
                method: 'POST',
                form: {
                    username: username,
                    password: password,
                    viewonline: 'on',
                    login: 'Přihlásit se'
                }
            }, (error, response) => {
                if (error) {
                    reject(error);
                }
                resolve(response);
            });
        });
    }

    static quit() {
        fnDebug('ForumScrapper.quit()');
        if (ForumScrapper.httpRequestCache) {
            ForumScrapper.httpRequestCache.backend.redisClient.quit()
        }
    }
}

ForumScrapper.request = defaultRequest;
ForumScrapper.PageType = PageType;
module.exports = ForumScrapper;

