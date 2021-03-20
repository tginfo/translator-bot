import os
import sys
import threading

from pyrogram import Client, filters
from pyrogram.types import Message

from .misc.filters import sudoers


def _restart(bot: Client, msg: Message):
    bot.stop()
    os.system("git pull")
    os.execl(sys.executable, sys.executable, *sys.argv, "-r", str(msg.chat.id))


@Client.on_message(filters.command(["r", "restart"]) & sudoers)
async def restart(bot, msg):
    """
    Restart the bot and its plugins.
    """
    await msg.reply_text("<b>Restarting...</b>")
    threading.Thread(target=_restart, args=(bot, msg)).start()
