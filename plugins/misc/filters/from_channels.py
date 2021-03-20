from pyrogram import Client, filters
from pyrogram.filters import Filter
from pyrogram.types import Message

from ...database import languages


async def from_channels_filter(flt: Filter, client: Client, message: Message):
    return message.chat.id in (
        x for x in await languages.get_languages() for x in x["from"]
    )


from_channels = filters.create(from_channels_filter)
