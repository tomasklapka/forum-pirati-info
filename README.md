# forum.pirati.info

Czech Pirate Party forum open mirror (https://forum.pirati.info)

Example `jsonCache` connection string connects to database created in postgresql with:
```SQL
CREATE USER forumpiraticz WITH PASSWORD 'forumpiraticz';
CREATE DATABASE forumpiraticz
  WITH OWNER = forumpiraticz
       ENCODING = 'UTF8';
```