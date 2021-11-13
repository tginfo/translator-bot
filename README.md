# 🌎 TGInfo Translate Bot
### A Telegram bot to help tginfo editors translating their posts.

---
# Deploy ✨
## Requirements
  - Python 3
  - A running MongoDB server

> If you want to use Docker instead, skip to [Docker Setup](https://github.com/tginfo/translator-bot#setup-with-docker-)
## Setup ⚙️
Firstly, you need a running MongoDB server, so you can either set up one yourself searching on the web or go **[here](https://github.com/tginfo/translator-bot#mongodb-with-docker-)**.
```
$ git clone https://github.com/tginfo/translator-bot
$ cd translator-bot

$ export API_ID=123456
$ export API_HASH="abcdefghijklmnopqrstuvwxyz"
$ export TOKEN="123456789:abcdefghijklmnopqrstuvwxyz"

$ python3 main.py
```
❓ **Note that the bot will load environment variables from env.list. Otherwise, if you want to use the environment ones, you can delete that file**
### Variables hierarchy:
  - CLI Arguments (most important)
  - `env.list` file
  - Environment Variables

## Setup (With Docker) 🐳
```
$ git clone https://github.com/tginfo/translator-bot
$ cd translator-bot

$ docker build -t translator .
$ docker run --rm --name translator --env-file env.list translator --help
```
### Usage Examples
#### Add a default admin and start the bot:
```
$ docker run --name translator --restart always translator --admin 1234
```
❓ **Note that** `--restart always` **option will restart the container everytime it shut-down or at system boot.**

#### 
```
$ docker run --name translator --env-file env.list translator
```
❓ `--env-file env.list` **option will load your local** `env.list` **file as environment variables inside your docker container.**

## MongoDB (With Docker) 🍃
```
$ docker pull mongo
$ cd path/to/translation-bot
$ docker run --rm --name mongo -p 0.0.0.0:27017:27017 -e MONGO_INITDB_ROOT_USERNAME=docker -e MONGO_INITDB_ROOT_PASSWORD=admin -v $(pwd)/mongodb:/data/db mongo
```
❓ **If you use MongoDB with Docker, you should use** `mongodb://docker:admin@172.17.0.1:27017` **as DB_URI.**

## Environment Variables
Name | Description
:----------- | :---
`TOKEN`      | Bot Token, you can get it from **[@BotFather](https://t.me/BotFather)**
`API_ID`     | Telegram api-id. You can get it from my.telegram.org/apps
`API_HASH`   | Telegram api-hash. You can get it from my.telegram.org/apps
`MS_API_KEY` | Microsoft Translate API Key. Needed as fallback for Google Translate for some languages
`DB_URI`     | MongoDB Database URI. See his **[docs](https://docs.mongodb.com/manual/reference/connection-string/)**

## CLI Arguments
### Do `python3 main.py --help`