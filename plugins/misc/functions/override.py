import inspect


def override(exception: Exception = None, run: bool = True):
    """Context Manager for exceptions, pass exception=None to silent them."""

    def decorator(func):
        async def async_wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except:
                pass
            if exception is not None:
                raise exception

        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except:
                pass
            if exception is not None:
                raise exception

        if run:
            try:
                func()
            except:
                pass
            if exception is not None:
                raise exception
        return async_wrapper if inspect.iscoroutinefunction(func) else wrapper

    return decorator
