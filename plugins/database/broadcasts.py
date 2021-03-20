from typing import List, Dict, Union

from . import db

c = db[0].client["translation_bot"]["broadcasts"]

"""
- chat_id int
"""


async def add_chat(chat_id: int) -> bool:
    if await get_chat(chat_id=chat_id):
        return False
    await c.update_one(
        {"chat_id": chat_id},
        {
            "$set": {
                "chat_id": chat_id,
            }
        },
        upsert=True,
    )
    return True


async def delete_chat(chat_id: int) -> bool:
    if await get_chat(chat_id=chat_id) is None:
        return False
    await c.delete_one(
        {
            "chat_id": chat_id,
        }
    )
    return True


async def get_chat(chat_id: int) -> Union[int, None]:
    find = await c.find_one(
        {
            "chat_id": chat_id,
        }
    )
    return find or None


async def get_chats() -> List[Dict[str, int]]:
    return await c.find().to_list(length=None)
