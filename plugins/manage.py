import asyncio
import html
import json
import os
from io import BytesIO
from typing import Callable

from pyrogram import Client, filters
from pyrogram.errors import RPCError
from pyrogram.types import (
    Message,
    CallbackQuery,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)

from .database import languages, sudoers as sudoers_, broadcasts, db
from .misc import sudoers
from .misc.functions import done, check_syntax, something_went_wrong
from .utils import remove_obj


async def json_command(bot: Client, msg: Message, func: Callable):
    if await check_syntax(bot, msg) is not None:
        return
    try:
        await func(**json.loads(msg.text.split(maxsplit=1)[1]))
    except Exception as e:
        return await something_went_wrong(bot=bot, msg=msg, error=e, func=func)
    await done(bot, msg)


async def command(
    bot: Client, msg: Message, func: Callable, message: str, reply: bool = False
):
    try:
        if reply:
            await func(msg.command[1], msg.reply_to_message.from_user.id)
        else:
            await func(msg.chat.id)
        await msg.reply_text(message.format(arg=msg.command[1]) if reply else message)
    except Exception as e:
        await something_went_wrong(bot=bot, msg=msg, error=e, func=None, hint=False)


@Client.on_message(filters.command("export") & sudoers)
async def debug(bot: Client, msg: Message):
    _ = BytesIO(
        json.dumps(
            remove_obj(
                {
                    "languages": await languages.get_languages(),
                    "sudoers": await sudoers_.get_sudoers(),
                    "broadcasts": await broadcasts.get_chats(),
                }
            )
        ).encode()
    )
    _.name = "database.json"
    await msg.reply_document(_)


@Client.on_message(
    filters.private & filters.reply & filters.text & filters.command("import") & sudoers
)
async def ask(_: Client, msg: Message):
    await msg.reply_to_message.reply_text(
        "Are you sure? This will erase the entire db.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("Yes", callback_data="yes")]]
        ),
        quote=True,
    )


@Client.on_callback_query(filters.regex("^yes$"))
async def import_database(bot: Client, query: CallbackQuery):
    if (
        query.message.reply_to_message.document
        and query.message.reply_to_message.document.mime_type == "application/json"
    ):
        sudo_fallback = await sudoers_.get_sudoers()
        try:
            _ = await query.message.reply_to_message.download()
            _db = json.loads(open(_).read())
            os.remove(_)
            m = await query.message.edit_text("<b>Importing...</b>")
            _languages, _sudoers, _broadcasts = (
                _db["languages"],
                _db["sudoers"],
                _db["broadcasts"],
            )
            await languages.drop()
            await sudoers_.drop()
            await broadcasts.drop()
            await asyncio.sleep(3)
            for lang in _languages:
                lang["from_"] = lang["from"]
                del lang["from"]
                await languages.update_language(**lang)
            for sudoer in _sudoers:
                await sudoers_.add_sudoer(sudoer)
            for broad in _broadcasts:
                await broadcasts.add_chat(**broad)
            await m.edit_text("<b>Database Updated</b>")
        except Exception as e:
            await query.message.edit_text(
                "<b>An error occurred while importing:</b>\n"
                + f"<code>{type(e).__name__}:{f' {type(e)}'.strip() or ''} {e}</code>"
            )
            for _sudoer in sudo_fallback:
                await sudoers_.add_sudoer(_sudoer)


@Client.on_message(filters.group & filters.command("link") & sudoers)
async def export_link(bot: Client, msg: Message):
    try:
        link = await msg.chat.export_invite_link()
        await msg.reply_text(link)
    except RPCError as e:
        await msg.reply_text(
            "Something went wrong.\n"
            + f"<code>{type(e).__name__}:{f' {type(e)}'.strip() or ''} {e}</code>"
        )


@Client.on_message(filters.command(["list", "show"]) & sudoers)
async def show_translators(bot: Client, msg: Message):
    if len(msg.text.split()) < 2:
        return await msg.reply_text("Provide a language code please. Example: <code>/list en</code>")
    try:
        language = msg.text.split()[1]
        langs = await languages.get_languages()
        try:
            ids = next(lang for lang in langs if lang["language"] == language)["translators"]
            if not ids:
                raise StopIteration()
            translators = await bot.get_users(ids)
            return await msg.reply_text(
                f"Translators of <code>'{html.escape(language)}'</code> language:\n"
                + "\n".join(
                    f" - {translator.mention}"
                    for translator in translators
                )
            )
        except StopIteration:
            return await msg.reply_text("No translators found for this language.")
    except RPCError as e:
        await msg.reply_text(
            "Something went wrong.\n"
            + f"<code>{type(e).__name__}:{f' {type(e)}'.strip() or ''} {e}</code>"
        )


@Client.on_message(filters.command(["addlanguage", "add_language"]) & sudoers)
async def add_language(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=languages.update_language)


@Client.on_message(filters.command(["addtr", "add_tr"]) & sudoers)
async def add_translator(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=languages.add_translator)


@Client.on_message(
    filters.command(["dellanguage", "del_language", "remlanguage", "rem_language"])
    & sudoers
)
async def del_language(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=languages.delete_language)


@Client.on_message(filters.command(["addsudo", "add_sudo"]) & sudoers)
async def add_sudoer(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=sudoers_.add_sudoer)


@Client.on_message(
    filters.command(["deluser", "del_user", "remuser", "rem_user"]) & sudoers
)
async def rem_sudoer(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=sudoers_.remove_sudoer)


@Client.on_message(filters.command(["addbroadcast", "add_broadcast"]) & sudoers)
async def add_broadcast(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=broadcasts.add_chat)


@Client.on_message(
    filters.command(["delbroadcast", "del_broadcast", "rembroadcast", "rem_broadcast"])
    & sudoers
)
async def del_broadcast(bot: Client, msg: Message):
    await json_command(bot=bot, msg=msg, func=broadcasts.delete_chat)


@Client.on_message(filters.command(["addto", "add_to"]) & filters.reply & sudoers)
async def add_to(bot: Client, msg: Message):
    await command(
        bot=bot,
        msg=msg,
        func=languages.add_translator,
        message="Added to {arg}.",
        reply=True,
    )


@Client.on_message(filters.command(["remfrom", "rem_from"]) & filters.reply & sudoers)
async def rem_from(bot: Client, msg: Message):
    await command(
        bot=bot,
        msg=msg,
        func=languages.rem_translator,
        message="Removed from {arg}.",
        reply=True,
    )


@Client.on_message(filters.command(["addtobroadcast", "add_to_broadcast"]) & sudoers)
async def add_to_broadcast(bot: Client, msg: Message):
    await command(
        bot=bot,
        msg=msg,
        func=broadcasts.add_chat,
        message="Added this chat to broadcast.",
    )


@Client.on_message(
    filters.command(["remfrombroadcast", "rem_from_broadcast"]) & sudoers
)
async def rem_from_broadcast(bot: Client, msg: Message):
    await command(
        bot=bot,
        msg=msg,
        func=broadcasts.delete_chat,
        message="Removed this chat from broadcast.",
    )
