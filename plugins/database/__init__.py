from typing import List

from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel


class Database(BaseModel):
    client: AsyncIOMotorClient

    # client(DB_URI)

    class Config:
        """Needed to permit arbitrary types usage (MongoCLient) with pydantic."""

        arbitrary_types_allowed = True


db: List[Database] = [...]
