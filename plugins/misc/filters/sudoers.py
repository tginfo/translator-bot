from typing import Union

from pyrogram import Client, filters
from pyrogram.filters import Filter
from pyrogram.types import Message, CallbackQuery

from ...database import sudoers as sudoers_


async def sudoers_filter(
    flt: Filter, client: Client, message: Union[Message, CallbackQuery]
):
    if hasattr(message, "message"):
        return message.message.from_user and message.message.from_user.id in (
            await sudoers_.get_sudoers()
        )
    else:
        return message.from_user and message.from_user.id in (
            await sudoers_.get_sudoers()
        )


sudoers = filters.create(sudoers_filter)
