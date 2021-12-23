from plugins.database.sudoers import get_sudoers
from typing import List, Dict, Union

from . import db

c = db[0].client["translation_bot"]["languages"]

"""
- language str
- from List[int]
- main int
- beta int
- edit int
- translators List[id]
"""


async def drop():
    await c.drop()


async def update_language(
    language: str,
    main: int,
    beta: int,
    edit: int,
    from_: List[Union[str, int]] = [-1001263222189, -1001253459535, -1001335406586],
    translators: List[int] = [],
    targetlang: str = "",
    microsoft: bool = False,
) -> bool:
    await c.update_one(
        {"language": language},
        {
            "$set": {
                "from": from_,
                "main": main,
                "beta": beta,
                "edit": edit,
                "translators": translators,
                "targetlang": targetlang,
                "microsoft": microsoft,
            }
        },
        upsert=True,
    )
    return True


async def add_translator(language: str, user_id: int) -> bool:
    lang = await get_language(language)
    del lang["_id"]
    lang["from_"] = lang["from"]
    del lang["from"]

    if user_id not in lang["translators"]:
        lang["translators"].append(user_id)
        await update_language(**lang)
        return True

    return False


async def rem_translator(language: str, user_id: int) -> bool:
    lang = await get_language(language)
    del lang["_id"]
    lang["from_"] = lang["from"]
    del lang["from"]

    if user_id in lang["translators"]:
        lang["translators"].remove(user_id)
        await update_language(**lang)
        return True


async def delete_language(language: str) -> bool:
    if await get_language(language=language) is None:
        return False
    await c.delete_one(
        {
            "language": language,
        }
    )
    return True


async def get_language(
    language: str,
) -> Dict[str, Union[str, int, bool, List[int]]]:
    find = await c.find_one(
        {
            "language": language,
        }
    )
    return find or None


async def get_languages() -> List[Dict[str, Union[str, int, List["str"], List[int]]]]:
    return await c.find().to_list(length=None)
