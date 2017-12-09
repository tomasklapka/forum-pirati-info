const debug = require('debug')('db');

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
                    /*
                    , `
                    CREATE TABLE IF NOT EXISTS "forums" (
                        "phpbbid" integer NOT NULL,
                        "parent_phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        CONSTRAINT "forums_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "topics" (
                        "phpbbid" integer NOT NULL,
                        "forum_phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        CONSTRAINT "topics_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "groups" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL,
                        "color" char(6),
                        CONSTRAINT "groups_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "users" (
                        "phpbbid" integer NOT NULL,
                        "url" text NOT NULL,
                        "title" varchar(255) NOT NULL DEFAULT '',
                        "color" char(6),
                        CONSTRAINT "users_pkey" PRIMARY KEY ("phpbbid")
                    )
                    `, `
                    CREATE TABLE IF NOT EXISTS "n2n_group_users" (
                        "group_phpbbid" integer NOT NULL,
                        "user_phpbbid" integer NOT NULL,
                        CONSTRAINT "users_pkey" PRIMARY KEY ("group_phpbbid", "user_phpbbid")
                    )
                    `
                     */
                ].map((query) => {
                    debug(query);
                    return this.client.query(query);
                });
                Promise.all(promises).then(resolve).catch(reject);
            }).catch(reject);
        })
    }

}
module.exports = Db;