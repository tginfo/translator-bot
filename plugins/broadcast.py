import asyncio

from pyrogram import Client, filters
from pyrogram.types import Message

from .database import broadcasts
from .misc.filters import sudoers


@Client.on_message(filters.reply & filters.command("broadcast") & sudoers)
async def broadcast(_: Client, msg: Message):
    """
    This will send a broadcast to all editors groups
    and pin that message.
    """
    for group in (x["chat_id"] for x in await broadcasts.get_chats()):
        try:
            await asyncio.sleep(0.5)
            m = await msg.reply_to_message.copy(chat_id=group)
            await m.pin()
        except:
            continue
