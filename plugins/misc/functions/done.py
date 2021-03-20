from typing import Union

from pyrogram import Client
from pyrogram.types import Message, CallbackQuery


async def done(bot: Client, update: Union[Message, CallbackQuery]):
    if isinstance(update, CallbackQuery):
        return await update.answer("Done", show_alert=True)
    else:
        return await update.reply_text("<b>Done!</b>", quote=True)
