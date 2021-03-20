#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys

import dotenv
from gpytranslate import Translator
from motor.motor_asyncio import AsyncIOMotorClient
from pyrogram import Client, idle

from plugins.config import config
from plugins.database import Database, db

if os.path.isfile("env.list"):
    dotenv.load_dotenv("env.list")

parser = argparse.ArgumentParser(
    description="A Telegram bot to help TGInfo editors translating their posts.",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter,
)

env_vars = (
    "TOKEN",
    "API_ID",
    "API_HASH",
    "MS_API_KEY",
    "DB_URI",
)
(
    config["token"],
    config["api_id"],
    config["api_hash"],
    config["ms_api_key"],
    config["db_uri"],
) = map(lambda _args: os.getenv(*_args), zip(env_vars, (None,) * len(env_vars)))

parser.add_argument("--token", help="Bot token",
                    required=not bool(config["token"]))
parser.add_argument(
    "--api-id",
    help="Telegram api-id. You can get it  from my.telegram.org/apps",
    type=int,
    required=not bool(config["api_id"]),
)
parser.add_argument(
    "--api-hash",
    help="Telegram api-hash. You can get it  from my.telegram.org/apps",
    required=not bool(config["api_hash"]),
)
parser.add_argument(
    "--db-uri",
    help="MongoDB URI",
    required=not bool(config["db_uri"]),
    type=str
)
parser.add_argument(
    "--ms-api-key",
    help="Microsoft translate api_key. Only for translating 'ku' lang code. Ignore if it's not in languages list.",
    default="",
)
parser.add_argument(
    "--admin", help="Use config.py as a fallback [DEPRECATED]", type=int, default=None
)
parser.add_argument(
    "-r",
    help="Send 'Restarted.' message to who restarted the bot.",
    type=int,
    required=False,
)
args = parser.parse_args()

config["ms_api_key"] = args.ms_api_key or config["ms_api_key"]
config["db_uri"] = args.db_uri or config["db_uri"]
config["tr"] = Translator()

db[0] = Database(client=AsyncIOMotorClient(config["db_uri"]))

bot = Client(
    "translate_bot",
    api_id=args.api_id or int(config["api_id"]),
    api_hash=args.api_hash or config["api_hash"],
    bot_token=args.token or config["token"],
    plugins=dict(root="plugins"),
    parse_mode="html",
)


async def main():
    from plugins.tests import test
    from plugins.database.sudoers import add_sudoer

    await test()
    await bot.start()
    if args.admin is not None:
        await add_sudoer(
            user_id=args.admin,
        )
    if args.r:
        try:
            await bot.send_message(args.r, "<b>Restarted.</b>")
        except:
            pass
    await idle()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.get_event_loop().run_until_complete(main()))
