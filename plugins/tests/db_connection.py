from ..database.languages import get_language


async def test():
    print("Testing Database...")
    await get_language("en")
    print("Done.")
