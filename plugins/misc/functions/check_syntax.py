import html

from pyrogram import Client
from pyrogram.types import Message


async def check_syntax(bot: Client, msg: Message):
    if len(msg.text.split()) < 2:
        return await msg.reply_text(
            f"Command must follow this syntax: <code>{html.escape(f'/{msg.command[0]} <json>')}</code>"
        )
