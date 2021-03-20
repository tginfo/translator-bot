import inspect
import textwrap
from typing import Callable, Union

from pyrogram import Client
from pyrogram.types import Message


async def something_went_wrong(
    bot: Client, msg: Message, error: Exception, func: Union[Callable, None], hint: bool = True
):
    return await msg.reply_text(
        "Something went wrong.\n"
        + f"<code>{type(error).__name__}:{f' {type(error)}'.strip() or ''} {error}</code>"
        + (
            f"\n\n<b>P.S. function arguments are:</b>\n"
            + textwrap.indent(
                "\n".join(
                    str(x) for x in list(inspect.signature(func).parameters.values())
                ),
                " - ",
            )
            if hint and hasattr(func, "__annotations__")
            else ""
        )
    )
