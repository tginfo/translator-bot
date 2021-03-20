from bson.objectid import ObjectId


def remove_obj(entry: dict) -> dict:
    return {
        k: remove_obj(v)
        if isinstance(v, dict)
        else [remove_obj(x) if isinstance(x, dict) else x for x in v]
        if isinstance(v, (list, dict))
        else v
        for k, v in entry.items()
        if not isinstance(v, ObjectId)
    }
