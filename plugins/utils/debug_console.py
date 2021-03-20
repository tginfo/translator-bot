import asyncio

from concurrent.futures import ThreadPoolExecutor


async def debug(func, *args):
    with ThreadPoolExecutor(1, "AsyncFunction") as executor:
        return await asyncio.get_event_loop().run_in_executor(executor, func, *args)
