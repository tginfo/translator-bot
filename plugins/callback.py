import datetime

from pyrogram import Client, filters
from pyrogram.errors import MessageIdInvalid, MessageNotModified
from pyrogram.types import (
    CallbackQuery,
    InputMediaPhoto,
    InputMediaVideo,
    InputMediaAnimation,
    InputMediaAudio,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
)

from .database import languages
from .misc.functions import done


async def not_modified(bot: Client, query: CallbackQuery):
    return await query.answer(
        "Message was not modified because it's the same as the one in the channel.",
        show_alert=True,
    )


@Client.on_callback_query(
    filters.regex(r"^(\w+)_(-?[0-9]+)_?([0-9]+)?$") & ~filters.regex("^idle")
)
async def callback(bot: Client, query: CallbackQuery):
    _lang, chat_id, *message_id = query.data.split("_")
    if message_id:
        message_id[0] = int(message_id[0])
    if _lang not in (x["language"] for x in await languages.get_languages()):
        return await query.answer(f"Language {_lang} not found.", show_alert=True)
    if (
        query.from_user.id
        not in (await languages.get_language(language=_lang))["translators"]
    ):
        return await query.answer("You're not allowed to do this.", show_alert=True)
    cb_msg_id = None
    try:
        if query.message.text:
            try:
                cb_msg_id = await bot.edit_message_text(
                    chat_id=chat_id,
                    message_id=message_id[0],
                    text=query.message.text.html,
                    disable_web_page_preview=not bool(query.message.web_page),
                    parse_mode="html",
                )
            except (MessageIdInvalid, IndexError) as e:
                cb_msg_id = await bot.send_message(
                    chat_id=chat_id,
                    text=query.message.text.html,
                    disable_web_page_preview=not bool(query.message.web_page),
                    parse_mode="html",
                )
        elif query.message.media:
            caption = (
                query.message.caption.html if query.message.caption else None or ""
            )
            if query.message.photo:
                try:
                    cb_msg_id = await bot.edit_message_media(
                        chat_id=chat_id,
                        message_id=message_id[0],
                        media=InputMediaPhoto(
                            media=query.message.photo.file_id,
                            caption=caption,
                            parse_mode="html",
                        ),
                    )
                except (MessageIdInvalid, IndexError):
                    cb_msg_id = await bot.send_photo(
                        chat_id=chat_id,
                        photo=query.message.photo.file_id,
                        caption=caption,
                        parse_mode="html",
                    )
            elif query.message.video:
                try:
                    cb_msg_id = await bot.edit_message_media(
                        chat_id=chat_id,
                        message_id=message_id[0],
                        media=InputMediaVideo(
                            media=query.message.photo.file_id,
                            caption=caption,
                            parse_mode="html",
                        ),
                    )
                except (MessageIdInvalid, IndexError):
                    cb_msg_id = await bot.send_video(
                        chat_id=chat_id,
                        video=query.message.video.file_id,
                        caption=caption,
                        parse_mode="html",
                    )
            elif query.message.animation:
                try:
                    cb_msg_id = await bot.edit_message_media(
                        chat_id=chat_id,
                        message_id=message_id[0],
                        media=InputMediaAnimation(
                            media=query.message.animation.file_id,
                            caption=caption,
                            parse_mode="html",
                        ),
                    )
                except (MessageIdInvalid, IndexError):
                    cb_msg_id = await bot.send_animation(
                        chat_id=chat_id,
                        animation=query.message.animation.file_id,
                        caption=caption,
                        parse_mode="html",
                    )
            elif query.message.sticker:
                await bot.send_sticker(
                    chat_id=chat_id, sticker=query.message.sticker.file_id
                )
                return await done(bot, query)
            elif query.message.audio:
                try:
                    cb_msg_id = await bot.edit_message_media(
                        chat_id=chat_id,
                        message_id=message_id[0],
                        media=InputMediaAudio(
                            media=query.message.photo.file_id,
                            caption=caption,
                            parse_mode="html",
                        ),
                    )
                except (MessageIdInvalid, IndexError) as e:
                    cb_msg_id = await bot.send_audio(
                        chat_id=chat_id,
                        audio=query.message.audio.file_id,
                        caption=caption,
                        parse_mode="html",
                    )
            elif query.message.poll:
                await bot.send_poll(
                    chat_id=chat_id,
                    question=query.message.poll.question,
                    options=[x["text"] for x in query.message.poll.options],
                    is_anonymous=query.message.poll.is_anonymous,
                    allows_multiple_answers=query.message.poll.allows_multiple_answers,
                )
                return await done(bot, query)
        cb_msg_id = cb_msg_id.message_id
    except MessageNotModified:
        await not_modified(bot, query)
    try:
        await query.message.edit_reply_markup(
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            (
                                "Edit in "
                                if len(
                                    query.message.reply_markup.inline_keyboard[0][
                                        0
                                    ].callback_data.split("_")
                                )
                                > 2
                                or cb_msg_id is not None
                                else "Send to "
                            )
                            + (
                                "BetaInfo"
                                if "beta"
                                in query.message.reply_markup.inline_keyboard[0][
                                    0
                                ].text.lower()
                                else "TGInfo"
                            )
                            + f" {_lang.upper()}",
                            callback_data=(
                                query.data
                                if cb_msg_id is None
                                else "_".join(
                                    map(str, (*query.data.split("_")[:2], cb_msg_id))
                                )
                            ),
                        )
                    ],
                    query.message.reply_markup.inline_keyboard[1],
                    [InlineKeyboardButton("Idle this post", callback_data="idle")],
                ]
            )
        )
    except MessageNotModified:
        pass
    return await done(bot, query)


@Client.on_callback_query(filters.regex(r"^idle"))
async def idle(bot: Client, query: CallbackQuery):
    if query.data != f"idle_{query.from_user.id}":
        await query.message.edit_reply_markup(
            reply_markup=InlineKeyboardMarkup(
                [
                    *query.message.reply_markup.inline_keyboard[:2],
                    [
                        InlineKeyboardButton(
                            f"{datetime.datetime.utcnow().strftime('%H:%M')} | Idle {query.from_user.first_name}",
                            callback_data=f"idle_{query.from_user.id}",
                        )
                    ],
                ]
            )
        )
    else:
        await query.message.edit_reply_markup(
            reply_markup=InlineKeyboardMarkup(
                [
                    *query.message.reply_markup.inline_keyboard[:2],
                    [InlineKeyboardButton("Idle this post", callback_data="idle")],
                ]
            )
        )
    await query.answer("❕ Done")
