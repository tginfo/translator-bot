from pyrogram import Client, filters


@Client.on_message(filters.regex("#(реклам(а|)|advertisement)"), group=-10)
async def ignore(bot: Client, _):
    await bot.stop_propagation()
