"use strict";

const debug = require('debug')('db');
const ForumScrapper = require('./forum_scrapper');

class Db {

    constructor(client) {
        this.client = client;
    }

    init() {
        return new Promise((resolve, reject) => {
            debug('init()');
            this.client.connect().then(() => {
                const promises = [`
                    SET TIME ZONE 'Europe/Prague'
                    `
                    , `
                    CREATE TABLE IF NOT EXISTS "forums" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        "parent_phpbbid" integer,
                        "lock" boolean NOT NULL DEFAULT false,
                        "rules" text,
                        CONSTRAINT "forums_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "topics" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        "forum_phpbbid" integer NOT NULL,
                        "lock" boolean NOT NULL DEFAULT false,
                        CONSTRAINT "topics_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `,  `
                    CREATE TABLE IF NOT EXISTS "posts" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL DEFAULT '',
                        "topic_phpbbid" integer NOT NULL,
                        "user_phpbbid" integer,
                        "content" text,
                        "created_at" timestamp without time zone,
                        CONSTRAINT "posts_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "groups" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        "color" char(7),
                        CONSTRAINT "groups_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "users" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL DEFAULT '',
                        "rank" varchar(255),
                        "default_group_phpbbid" integer,
                        "color" char(7),
                        "avatar" text,
                        "signature" text,
                        "www" text,
                        "jabber" varchar(255),
                        "icq" varchar(10),
                        "age" smallint,
                        "address" text,
                        "occupation" text,
                        "profession" text,
                        "interests" text,
                        "total_posts" integer,
                        "likes_got" integer,
                        "likes_gave" integer,
                        "show_on_map" boolean,
                        "registered_at" timestamp without time zone,
                        "last_visit_at" timestamp without time zone,
                        CONSTRAINT "users_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "n2n_group_user" (
                        "group_phpbbid" integer NOT NULL,
                        "user_phpbbid" integer NOT NULL,
                        CONSTRAINT "n2n_group_user_pkey" PRIMARY KEY ("group_phpbbid", "user_phpbbid")
                    )
                    `
                ].map((query) => {
                    debug(query);
                    return this.client.query(query);
                });
                Promise.all(promises).then(resolve).catch(reject);
            }).catch(reject);
        })
    }

    save(data) {
        const PageType = ForumScrapper.PageType;
        const saves = {
            phpbbid: data.phpbbid,
            url: data.unbased,
            title: data.title
        };
        const promises = [];
        let table = null;
        switch (data.typeid) {
            case PageType.Root:
                table = 'forums';
                saves.parent_phpbbid = null;
                break;
            case PageType.Forum:
                table = 'forums';
                saves.parent_phpbbid = ForumScrapper.forumIdFromUrl(data.navi.parent);
                promises.push(this.save_locked_entities(data));
                saves.rules = data.rules;
                break;
            case PageType.Thread:
                table = 'topics';
                saves.forum_phpbbid = ForumScrapper.forumIdFromUrl(data.navi.forum);
                promises.push(this.save_posts(data.phpbbid, data.posts));
                break;
            case PageType.Group:
                table = 'groups';
                saves.color = data.color;
                promises.push(this.save_users(data.phpbbid, data.users));
                break;
            case PageType.User:
                table = 'users';
                const u = data.user;
                saves.rank = u.rank;
                if (u.defaultGroup && +u.defaultGroup.phpbbid > 0) {
                    saves.default_group_phpbbid = +u.defaultGroup.phpbbid;
                }
                saves.color = u.color;
                saves.avatar = u.avatarSrc;
                saves.signature = u.signature;
                saves.www = u.www;
                saves.jabber = u.jabber;
                saves.icq = u.icq;
                saves.age = +u.age;
                saves.address = u.address;
                saves.occupation = u.occupation;
                saves.profession = u.profession;
                saves.interests = u.interests;
                saves.total_posts = +u.totalPosts;
                saves.likes_got = +u.likesGot;
                saves.likes_gave = +u.likesGave;
                saves.show_on_map = u.showOnMap;
                saves.registered_at = u.registered;
                saves.last_visit_at = u.lastVisit;
                promises.push(this.save_groups(data.phpbbid, u.groups));
                break;
        }
        if (table === null) {
            return Promise.resolve();
        }
        promises.push(this.store_saves(table, saves));
        return Promise.all(promises);
    }

    save_posts(topic_phpbbid, posts) {
        debug('save_posts %d %d', topic_phpbbid, posts.length);
        return new Promise((resolve, reject) => {
            const promises = [];
            for (let i = 0; i < posts.length; i++) {
                const post = posts[i];
                const saves = {
                    phpbbid: post.phpbbid,
                    url: post.url.replace(this.base),
                    title: post.title,
                    topic_phpbbid: topic_phpbbid,
                    user_phpbbid: ForumScrapper.userIdFromUrl(post.user),
                    created_at: post.created,
                };
                promises.push(this.store_saves('posts', saves));
            }
            Promise.all(promises).then(resolve).catch(reject);
        });
    }

    save_post_content(post_phpbbid, content) {
        debug('save_post_content %d %d', post_phpbbid, content.length);
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE "posts" SET "content" = $1 WHERE phpbbid = $2
            `;
            this.client.query(query, [ content, post_phpbbid ]).then(resolve).catch(reject);
        });
    }

    save_locked_entities(data) {
        const forums_ids = Object.keys(data.forums);
        const announcements_ids = Object.keys(data.announcements);
        const threads_ids = Object.keys(data.threads);
        debug('save_locked_entities %d, %d, %d', forums_ids.length, announcements_ids.length, threads_ids.length);
        return new Promise((resolve, reject) => {
            const promises = [];
            const client = this.client;

            function update(table, entity) {
                const query = `
                    UPDATE "`+table+`" SET "lock" = $1 WHERE "phpbbid" = $2
                `;
                const values = [ entity.locked, entity.phpbbid ];
                // debug('"%s" values: "%o"', query, values);
                promises.push(client.query(query, values));
            }

            for (let i = 0; i < forums_ids.length; i++) {
                update('forums', data.forums[forums_ids[i]]);
            }
            for (let i = 0; i < announcements_ids.length; i++) {
                update('topics', data.announcements[announcements_ids[i]]);
            }
            for (let i = 0; i < threads_ids.length; i++) {
                update('topics', data.threads[threads_ids[i]]);
            }
            Promise.all(promises).then(resolve).catch(reject);
        })
    }

    save_users(group_phpbbid, users) {
        debug('save_users %d %d', group_phpbbid, Object.keys(users).length);
        return new Promise((resolve, reject) => {
            const ids = Object.keys(users);
            const query = `
                INSERT INTO n2n_group_user (group_phpbbid, user_phpbbid) VALUES ($1, $2) ON CONFLICT DO NOTHING;
            `;
            const promises = [];
            // debug(query);
            for(let i = 0; i < ids.length; i++) {
                if (ids[i] !== 'null') {
                    promises.push(this.client.query(query, [group_phpbbid, ids[i]]));
                }
            }
            Promise.all(promises).then(resolve).catch(reject);
        });
    }

    save_groups(user_phpbbid, groups) {
        debug('save_groups %d %d', user_phpbbid, Object.keys(groups).length);
        return new Promise((resolve, reject) => {
            const ids = Object.keys(groups);
            const query = `
                INSERT INTO n2n_group_user (user_phpbbid, group_phpbbid) VALUES ($1, $2) ON CONFLICT DO NOTHING;
            `;
            const promises = [];
            debug(query);
            for(let i = 0; i < ids.length; i++) {
                const values = [ user_phpbbid, +ids[i] ];
                debug('values: "%o"', values);
                promises.push(this.client.query(query, values));
            }
            Promise.all(promises).then(resolve).catch(reject);
        });
    }

    store_saves(table, saves) {
        const keys = Object.keys(saves);
        const values = [];
        const params = [];
        const updates = [];
        const dont_update_fields = [ 'phpbbid' ];
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            values.push(saves[key]);
            params.push('$'+(i+1));
            if (dont_update_fields.indexOf(key) === -1) {
                updates.push(`"`+key+`" = $`+(i+1))
            }
        }
        const query = `
            INSERT INTO "`+table+`" ("`+keys.join('", "')+`")
                VALUES (`+params.join(', ')+`)
                ON CONFLICT ON CONSTRAINT "`+table+`_pkey" DO
            UPDATE SET `+updates.join(', ');
        // debug(query);
        // debug('Values: %o', values);
        return this.client.query(query, values);
    }

    get_first(table, phpbbid) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM "`+table+`" WHERE "phpbbid" = $1
            `;
            debug('%s values: %o', query, [ phpbbid ]);
            this.client.query(query, [ phpbbid ]).then((result) => {
                if (result.rows.length > 0) {
                    resolve(result.rows[0]);
                    return;
                }
                resolve(null);
            }).catch(reject)
        })
    }

    post(post_phpbbid) {
        return this.get_first('posts', post_phpbbid);
    }
}
module.exports = Db;