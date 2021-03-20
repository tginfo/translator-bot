from pyrogram import Client, filters
from pyrogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton

from .config import config
from .database import languages
from .misc.filters import from_channels
from .utils import ms_translate


@Client.on_message(filters.poll & ~filters.service & from_channels)
async def poll(bot: Client, msg: Message):
    """
    This will translate polls sent in the main_channel.
    Note that quiz polls are translated as normal polls because
    bot can't fetch the right answer of the quiz, hence it cannot
    set it as the right one in his translated poll.
    """
    for language in await languages.get_languages():
        _from = language["from"]
        _main = language["main"]
        _beta = language["beta"]
        _edit = language["edit"]
        if msg.chat.id not in _from:
            continue
        options = "\n".join(x["text"] for x in msg.poll.options)
        try:
            translation = (
                await ms_translate(
                    text=f"{msg.poll.question}\n{options}",
                    lang_code=language["language"],
                    api_key=config["ms_api_key"],
                )
                if language["microsoft"]
                and config["ms_api_key"].strip().lower() != "empty"
                else (
                    await config["tr"](
                        f"{msg.poll.question}\n{options}",
                        targetlang=language["language"],
                    )
                ).text
            )
        except AttributeError:
            continue
        question = translation.split("\n", 1)[0]
        options = translation.splitlines()[1:]
        await bot.send_poll(
            chat_id=_edit,
            question=question,
            options=options,
            is_anonymous=msg.poll.is_anonymous,
            allows_multiple_answers=msg.poll.allows_multiple_answers,
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton(
                            f"Send to TGInfo {language['language'].upper()}",
                            callback_data=f"{language['language']}_{_main}",
                        )
                    ],
                    [
                        InlineKeyboardButton(
                            f"Send to BetaInfo {language['language'].upper()}",
                            callback_data=f"{language['language']}_{_beta}",
                        )
                    ],
                ],
            ),
        )
