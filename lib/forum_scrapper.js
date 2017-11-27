const debug = require('debug')('forum-scrapper');
const fnDebug = require('debug')('fn:forum-scrapper');

const removeDiacritics = require('diacritics').remove;
const cheerio = require('cheerio');
const origRequest = require('request');
const URL = require('url');

const requestExt = require('request-extensible');
const RequestHttpCache = require('request-http-cache');

const PageType = {
    None: 0,
    Root: 1,
    Forum: 2,
    Thread: 3,
    Post: 4,
    Group: 5,
    User: 6,
    Unanswered: 7,
    ActiveTopics: 8,
    NewPosts: 9,
    UnreadPosts: 10,
    UserTopics: 11,
    Memberlist: 12,
    UserPosts: 13,
    Search: 14,
};

const rootUrl = new RegExp(/^https?:\/\/[^\/]+\/?$/);
const forumUrl = new RegExp(/^http.*-f(\d+)\/?$/);
const forumPageUrl = new RegExp(/^http.*-f(\d+)\/page(\d+).html$/);
const threadUrl = new RegExp(/^http.*-t(\d+)\.html$/);
const threadPageUrl = new RegExp(/^http.*-t(\d+)(-\d+)?\.html$/);
const postUrl = new RegExp(/^http.*\.html#p(\d+)\/?$/);
const userUrl = new RegExp(/^http.*-u(\d+)\/?$/);
const userPostsUrl = new RegExp(/^http.*-u(\d+)\/posts\/?$/);
const groupUrl = new RegExp(/^http.*-g(\d+).html$/);
const groupPageUrl = new RegExp(/^http.*-g(\d+)-(\d+).html$/);
const unansweredUrl = new RegExp(/^https?:\/\/[^\/]+\/unanswered(-(\d+))?\.html$/);
const activeTopicsUrl = new RegExp(/^https?:\/\/[^\/]+\/active-topics(-(\d+))?\.html$/);
const unreadPostsUrl = new RegExp(/^https?:\/\/[^\/]+\/unreadposts(-(\d+))?\.html$/);
const memberlistUrl = new RegExp(/^https?:\/\/[^\/]+\/memberlist(-(\d+))?\.php(\?.*)?$/);
const searchUrl = new RegExp(/^https?:\/\/[^\/]+\/search\.php(\?.*)?$/);

const defaultRequest = origRequest.defaults({ jar: true });

class ForumScrapper {

    constructor(url, requestCache) {
        this.phpbbid = null;
        this.url = url;
        this.title = null;
        this.type = null;
        this.typeId = null;
        this.forumUrl = null;
        this.parentForumUrl = null;
        this.firstPageUrl = null;
        this.page = null;

        // user data
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

        this.resolve = null;
        this.reject = null;
        this.$ = null;
        this.httpRequestCache = null;
        this.defaultRequest = null;
        this.request = null;

        this.superForums = [];
        this.forums = [];
        this.announcements = [];
        this.threads = [];
        this.posts = [];
        this.users = [];
        this.links = [];
        this.PageType = PageType;

        this.requestCache = requestCache;
    }

    static linkType(url) {
        if (!url) return PageType.None;
        if (forumUrl.exec(url)) {
            return PageType.Forum;
        }
        if (forumPageUrl.exec(url)) {
            return PageType.Forum;
        }
        if (threadUrl.exec(url)) {
            return PageType.Thread;
        }
        if (threadPageUrl.exec(url)) {
            return PageType.Thread;
        }
        if (postUrl.exec(url)) {
            return PageType.Post;
        }
        if (userUrl.exec(url)) {
            return PageType.User;
        }
        if (groupUrl.exec(url)) {
            return PageType.Group;
        }
        if (groupPageUrl.exec(url)) {
            return PageType.Group;
        }
        if (rootUrl.exec(url)) {
            return PageType.Root;
        }
        if (unansweredUrl.exec(url)) {
            return PageType.Unanswered;
        }
        if (activeTopicsUrl.exec(url)) {
            return PageType.ActiveTopics;
        }
        if (unreadPostsUrl.exec(url)) {
            return PageType.UnreadPosts;
        }
        if (memberlistUrl.exec(url)) {
            return PageType.Memberlist;
        }
        if (userPostsUrl.exec(url)) {
            return PageType.UserPosts;
        }
        if (searchUrl.exec(url)) {
            return PageType.Search;
        }
        return PageType.None;
    }

    scrap() {
        fnDebug('this.scrap()');
        debug('this.url: %s', this.url);
        this.type = ForumScrapper.linkType(this.url);
        return new Promise((resolve, reject) => {
            if (this.resolve || this.reject) {
                reject('scrap not finished yet');
            }
            this.resolve = resolve;
            this.reject = reject;
            let scrappingRequest = defaultRequest;
            if (this.requestCache) {
                if (!this.request) this.initCache();
                scrappingRequest = this.request;
            }
            debug('scrappingRequest ', this.url);
            scrappingRequest({url: this.url}, (err, response, body) => {
//                debug('scrappingRequest ', body);
                if (err) {
                    this.reject(err);
                    return;
                }
                if (!body) {
                    this.reject('no content');
                    return;
                }
                try {
                    this.$ = cheerio.load(body);
                } catch (err) {
                    console.log(response);
                    console.log('Cheerio parsing body: %s\n#####\n%s\n#####', this.url, body);
                    console.log('Cheerio parsing error: %s', err);
                    this.reject(err);
                }
                this.scrapLinks();
                this.scrapParent();
                this.scrapPagination();
                debug('type: %d', this.type);
                switch (this.type) {
                    case PageType.Root:
                        this.title = this.$('title').text();
                    case PageType.Forum:
                    case PageType.Unanswered:
                    case PageType.ActiveTopics:
                    case PageType.UnreadPosts:
                        this.scrapForum();
                        break;
                    case PageType.UserPosts:
                    case PageType.Thread:
                    case PageType.Search:
                        this.scrapThread();
                        break;
                    case PageType.User:
                        this.scrapUser();
                        break;
                    case PageType.Memberlist:
                    case PageType.Group:
                        this.scrapGroup();
                        break;
                }
                this.$ = null;
                setTimeout(() => {
                    this.resolve(this);
                }, 100);
            });
        });
    }

    scrapLinks() {
        fnDebug('this.scrapLinks()');
        this.$('a').each((i, a) => {
            const linkUrl = this.$(a).attr('href');
            const type = ForumScrapper.linkType(this.$(a).attr('href'));
            if ((linkUrl || typeof linkUrl === typeof 'string') && type !== PageType.None) {
                this.links.push({
                    title: this.$(a).text(),
                    url: linkUrl.replace(/#wrap$/, ''),
                    type: type
                });
            }
        });
    }

    scrapParent() {
        fnDebug('this.scrapParent()');
        const linkPath = this.$('div#page-header').children('div.navbar').children('div.inner').children('ul.navlinks')
            .children('li.icon-home').children('a');
        this.forumUrl = linkPath.last().attr('href');
        if (linkPath.length > 1) {
            this.parentForumUrl = linkPath.last().prev().prev().attr('href');
        }
    }

    scrapForum() {
        fnDebug('this.scrapForum()');
        this.phpbbid = ForumScrapper.forumIdFromUrl(this.url);
        const title = this.$('div#page-body').children("h2").text();
        if (title) {
            this.title = title;
        }
        let superForum = { phpbbid: null };
        this.$('.topiclist').each((i, p) => {
            if (this.$(p).hasClass('topics')) {
                debug('topic section', i);
                this.$(p).children('li').each((i, p) => {
                    debug('topic row', i);
                    const topicLink = this.$(p).children('dl').children('dt').children('a.topictitle');
                    const topicUrl = topicLink.attr('href');
                    const topic = {
                        phpbbid: ForumScrapper.threadIdFromUrl(topicUrl),
                        url: topicUrl,
                        title: topicLink.text()
                    };
                    if (this.$(p).hasClass('global-announce')) {
                        this.announcements.push(topic);
                    } else {
                        this.threads.push(topic);
                    }
                })
            } else {
                if (this.$(p).hasClass('forums')) {
                    debug('forum section', i);
                    this.$(p).children('li').each((i, p) => {
                        debug('forum row', i);
                        const dl = this.$(p).children('dl');
                        const forumLink = dl.children('dt').children('a.forumtitle');
                        const forumUrl = forumLink.attr('href');
                        const nTopics = dl.children('dd.topics').text().split(' ').shift()*1;
                        const nPosts = dl.children('dd.posts').text().split(' ').shift()*1;
                        let lastPost = {
                            user: null,
                            post: null,
                            time: null
                        };
                        dl.children('dd.lastpost').children('span').children('a').each((i, p) => {
                            const lastPostUrl = this.$(p).attr('href');
                            const urlType = ForumScrapper.linkType(lastPostUrl);
                            if (urlType === PageType.User) {
                                lastPost.user = lastPostUrl;
                            } else {
                                if (urlType === PageType.Post) {
                                    lastPost.post = lastPostUrl;
                                }
                            }
                        });
                        if (lastPost.post) {
                            const lastPostTime = dl.children('dd.lastpost').children('span').text().split(/\n/);
                            lastPost.time = lastPostTime[lastPostTime.length-1].trim();
                        } else {
                            lastPost = null;
                        }

                        const forum = {
                            phpbbid: ForumScrapper.forumIdFromUrl(forumUrl),
                            url: forumUrl,
                            title: forumLink.text(),
                            n_topics: nTopics,
                            n_posts: nPosts,
                            last_post: lastPost,
                            parentForum_phpbbid: superForum.phpbbid
                        };
                        this.forums.push(forum);
                    })
                } else {
                    debug('superForum', i);
                    const superForumLink = this.$(p).children('li').children('dl').children('dt').children('a');
                    const superForumUrl = superForumLink.attr('href');
                    superForum = {
                        phpbbid: ForumScrapper.forumIdFromUrl(superForumUrl),
                        url: superForumUrl,
                        title: superForumLink.text()
                    };
                    if (superForum.phpbbid !== null) {
                        this.superForums.push(superForum);
                    }
                }
            }
        });
    }

    scrapUser() {
        fnDebug('this.scrapUser()');
        const user = this.user;
        this.phpbbid = ForumScrapper.userIdFromUrl(this.url);
        this.title = this.$('dl.details').first().children('dd').children('span').text();
        user.signature = this.$('.signature').html();

        const userBody = this.$('form#viewprofile').children('div.panel');
        const userBodyPanel1 = userBody.first().children('div.inner').children('dl');
        user.avatarSrc = userBodyPanel1.first().children('dt').children('img').first().attr('src');
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
                        const groupUrl = this.makeGroupUrl(id, option.text());
                        if (option.attr('selected') === 'selected') {
                            user.defaultGroup = groupUrl;
                        }
                        user.groups[id] = groupUrl;
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
                    user.lastVisit = (dd.text() === ' - ') ? null : this.parseDate(dd.text());
                    break;
                case 'Celkem příspěvků:':
                    user.totalPosts = +dd.text().split(/\n/).shift().replace(/ .*$/m, '');
                    break;
            }
        });
        user.likesGave = +userBody.first().next().next().next().next()
            .children('div.inner').children('dl').children('dt').text()
            .replace(/Dal poděkování: /, '')
            .replace(/ krát/, '');
        user.likesGot = +userBody.first().next().next().next().next().next()
            .children('div.inner').children('dl').children('dt').text()
            .replace(/Dostal poděkování: /, '')
            .replace(/ krát/, '');
        this.user = user;
    }

    scrapGroup() {
        fnDebug('this.scrapGroup()');
        this.phpbbid = ForumScrapper.groupIdFromUrl(this.url);
        this.title = this.$('h2').text();
        this.$('tbody').children('tr').each((i, e) => {
            const td = this.$(e).children('td').first();
            this.users.push(td.children('a').attr('href'));
        });
    }

    scrapPagination() {
        fnDebug('this.scrapPagination()');
        const pagination = this.$('.pagination').children('a').children('strong');
        this.page = +pagination.first().text();
        if (this.page > 0) {
            this.firstPageUrl = this.url;
            switch (this.type) {
                case PageType.Forum:
                    this.firstPageUrl = this.url.replace(/\/page\d+\.html$/, '/');
                    break;
                case PageType.Group:
                case PageType.Thread:
                    this.firstPageUrl = this.url.replace(/-\d+\.html$/, '.html');
                    break;
            }
        }
    }

    scrapThread() {
        fnDebug('this.scrapThread()');
        this.phpbbid = ForumScrapper.threadIdFromUrl(this.url);
        this.title = this.$('div#page-body').children("h2").text();
        this.$('.post').each((i, p) => {
            const postBody = this.$(p).children('div.inner').children('div.postbody');
            const postProfileBody = this.$(p).children('div.inner').children('dl.postprofile');
            const titleLink = postBody.children('h3').children('a');
            let authorBody = postBody.children('p.author');
            let authorLink;
            let authorUrl;
            let authorName;
            let created;
            let likes;

            if (authorBody.length > 0) {
                const authorLink = authorBody.children('strong').children('a');
                const likesBody = postBody.children('div.content').last().children('dl.postbody').children('dd').children('a');
                likes = [];
                likesBody.each((j, a) => {
                    likes.push(this.$(a).attr('href'));
                });
                created = this.convertCreatedDate(authorBody);
                authorUrl = authorLink.attr('href');
                authorName = authorLink.text();
                if (!authorUrl) {
                    authorName = authorBody.children('strong').children('span').text();
                    authorUrl = 'unregistered:' + ForumScrapper.normalizeString(authorName);
                }
            }

            authorBody = postProfileBody.children('dt');
            authorLink = authorBody.children('a');
            if (!authorName || !(authorName.length > 0)) {
                authorUrl = authorLink.attr('href');
                authorName = authorLink.text();
            }
            if (authorBody.hasClass('author')) {
                created = this.convertCreatedDate(authorBody.next());
            }

            const post = {
                phpbbid: ForumScrapper.postIdFromUrl(titleLink.attr('href')),
                url: titleLink.attr('href').replace(/\?[^#]*/, ''),
                title: titleLink.text(),
                authorUrl: authorUrl,
                authorName: authorName,
                created: created,
                content: postBody.children('div.content').first().html(),
                likes: likes
            };
            if (post.phpbbid) {
                this.posts.push(post);
            }
        });
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

    static forumIdFromUrl(url) {
        const re = /-f(\d+)\/?(page\d+\.html)?$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static threadIdFromUrl(url) {
        const re = /-t(\d+)(-\d+)?\.html$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static userIdFromUrl(url) {
        const re = /-u(\d+)\/?$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static groupIdFromUrl(url) {
        const re = /-g(\d+)(-\d+)?\.html$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static postIdFromUrl(url) {
        const re = /#p(\d+)$/;
        const matches = re.exec(url);
        if (matches && matches[1]) {
            return +matches[1];
        }
        return null;
    }

    static postId(hash) {
        let id = hash;
        if (id) {
            id = '' + id;
            if (id.length > 0) {
                return +id.replace(/^p/, '');
            }
        }
        return null;
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
        const c = date.split(/ /);
        if (c.length > 1) {
            return c[2].replace(',', '') + '-' + ForumScrapper.month(c[1]) + '-' + c[0] + ' ' + c[3];
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
            }, (error, response, body) => {
                if (error) {
                    debug(error);
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

module.exports = ForumScrapper;