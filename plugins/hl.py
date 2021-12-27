import json
from urllib.parse import urlencode

from pyrogram import Client, filters
from pyrogram.methods import password
from pyrogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton
from pyrogram.types.bots_and_keyboards import keyboard_button

from .database import languages
from .config import config

text = """
1. Click the button below.
2. A moment after clicking, you should be redirected back to Telegram.
3. Once on Telegram, you will see me.
4. Click the start button.
"""


@Client.on_message(
    filters.group & filters.reply & filters.command("hl") & ~filters.edited
)
async def hl(bot: Client, message: Message):
    if not config["hl_url"]:
        await message.reply("Not supported.")
        return
    elif (
        message.reply_to_message.forward_from_chat.id
        != (await bot.get_chat(message.chat.id)).linked_chat.id
    ):
        await message.reply("Please reply to an untranslated channel post.")
        return

    try:
        tl = message.text.split(maxsplit=1)[1]
    except Exception:
        await message.reply("Please pass your language code.")
        return

    q = (message.reply_to_message.text or message.reply_to_message.caption).html
    is_caption = message.reply_to_message.caption is not None
    message_id = message.reply_to_message.forward_from_message_id

    if q is None:
        await message.reply("The replied post must have text or caption.")
        return

    language = await languages.get_language(tl)

    if language is None:
        await message.reply("An invalid language code was provided.")
        return

    chat_id = language["edit"]

    if message.reply_to_message.forward_from_chat.id != chat_id:
        await message.reply(
            "The replied post is not from the middle channel of the language you provided."
        )
        return

    url = (
        config["hl_url"]
        + "?"
        + urlencode(
            {
                "a": json.dumps(
                    {
                        "q": q,
                        "tl": tl,
                        "chat_id": chat_id,
                        "message_id": message_id,
                        "is_caption": is_caption,
                    }
                ).encode()
            }
        )
    )

    await message.reply(
        text,
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton("Open Helper", url=url)]]
        ),
    )


@Client.on_message(
    filters.private & filters.command("start") & ~filters.edited & ~filters.forwarded
)
async def ed(bot: Client, message: Message):
    try:
        b = json.loads(message.text.split(maxsplit=1)[1])

        chat_id = b["chat_id"]
        message_id = b["message_id"]
        is_caption = b["is_caption"]
        text = b["text"]
    except Exception:
        return

    if (
        not isinstance(chat_id, int)
        or not isinstance(message_id, int)
        or not isinstance(is_caption, bool)
        or not isinstance(text, str)
    ):
        await message.reply("An invalid query was provided.")
        return

    try:
        if is_caption:
            await bot.edit_message_caption(chat_id, message_id, text)
        else:
            await bot.edit_message_text(chat_id, message_id, text)
    except Exception:
        await message.reply("Could not assign the translation.")
        return

    await message.reply("Translation assigned successfully.")
