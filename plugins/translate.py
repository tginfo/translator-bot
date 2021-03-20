import asyncio
from pyrogram import Client, filters
from pyrogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton

from .config import config
from .database import languages
from .misc.filters import from_channels
from .utils import ms_translate


@Client.on_message(
    from_channels
    & ~filters.edited
    & ~filters.service
    & ~(
        filters.voice
        & filters.video_note
        & filters.contact
        & filters.location
        & filters.venue
        & filters.poll
    )
)
async def translate(bot: Client, msg: Message):
    """
    This will translate messages and send them to the language respective editors channel.
    """
    try:
        text = msg.text.html if msg.text else msg.caption.html
    except AttributeError:
        text = None
    for language in await languages.get_languages():
        translation = ""
        _from = language["from"]
        _main = language["main"]
        _beta = language["beta"]
        _edit = language["edit"]
        if msg.chat.id not in _from:
            continue
        await asyncio.sleep(0.5)
        is_beta = (
            "beta"
            in "".join(
                (
                    msg.chat.title,
                    msg.forward_from_chat.title if msg.forward_from_chat else "",
                )
            ).lower()
        )
        reply_markup = InlineKeyboardMarkup(
            [
                [
                    InlineKeyboardButton(
                        f"Send to {'BetaInfo' if is_beta else 'TGInfo'} {language['language'].upper()}",
                        callback_data=f"{language['language']}_"
                        + str(_beta if is_beta else _main),
                    )
                ],
                [
                    InlineKeyboardButton(
                        "Original Message",
                        url=f"t.me/c/{abs(msg.forward_from_chat.id+1000000000000)}/{msg.forward_from_message_id}"
                        if msg.forward_from_chat
                        else msg.link,
                    )
                ],
                [InlineKeyboardButton("Idle this post", callback_data="idle")],
            ],
        )
        try:
            if text:
                translation = (
                    await ms_translate(
                        text=text,
                        lang_code=language["language"],
                        api_key=config["ms_api_key"],
                    )
                    if language["microsoft"]
                    and config["ms_api_key"].strip().lower() != "empty"
                    else (
                        await config["tr"](
                            text,
                            targetlang=language["language"],
                            sourcelang="auto" if _from != -1001263222189 else "en",
                        )
                    )
                    .text.replace("> ", ">")
                    .replace("# ", "#")
                )
        except AttributeError:
            continue
        if msg.text:
            await bot.send_message(
                chat_id=_edit,
                text=translation,
                parse_mode="html",
                disable_web_page_preview=not bool(msg.web_page),
                reply_markup=reply_markup,
            )
        elif msg.media:
            if msg.photo:
                await bot.send_photo(
                    chat_id=_edit,
                    photo=msg.photo.file_id,
                    caption=translation,
                    parse_mode="html",
                    reply_markup=reply_markup,
                )
            elif msg.video:
                await bot.send_video(
                    chat_id=_edit,
                    video=msg.video.file_id,
                    caption=translation,
                    parse_mode="html",
                    reply_markup=reply_markup,
                )
            elif msg.animation:
                await bot.send_animation(
                    chat_id=_edit,
                    animation=msg.animation.file_id,
                    caption=translation,
                    parse_mode="html",
                    reply_markup=reply_markup,
                )
            elif msg.sticker:
                await bot.send_sticker(
                    chat_id=_edit,
                    sticker=msg.sticker.file_id,
                    reply_markup=reply_markup,
                )
            elif msg.audio:
                await bot.send_audio(
                    chat_id=_edit,
                    audio=msg.audio.file_id,
                    caption=translation,
                    parse_mode="html",
                    reply_markup=reply_markup,
                )
