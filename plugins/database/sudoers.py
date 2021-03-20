from typing import List

from . import db

c = db[0].client["translation_bot"]["sudoers"]

"""
- user_id int
"""


async def add_sudoer(user_id: int) -> bool:
    if await is_sudoer(user_id):
        return False

    await c.insert_one({"user_id": user_id})
    return True


async def remove_sudoer(user_id: int) -> bool:
    if not await is_sudoer(user_id):
        return False

    await c.delete_one(
        {
            "user_id": user_id,
        }
    )
    return True


async def is_sudoer(user_id: int) -> bool:
    find = await c.find_one(
        {
            "user_id": user_id,
        }
    )
    return bool(find or None)


async def get_sudoers() -> List[int]:
    return [sudoer["user_id"] for sudoer in await c.find().to_list(length=None)]
