from pyrogram import Client, filters
from pyrogram.types import Message


@Client.on_message(filters.regex("#(реклам(а|)|advertisement)"), group=-10)
async def ignore(_, message: Message):
    await message.stop_propagation()
