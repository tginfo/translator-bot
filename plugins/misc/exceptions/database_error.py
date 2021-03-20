class DatabaseError(Exception):
    def __init__(self, uri: str):
        self.uri = uri

    def __str__(self):
        return f"URI {self.uri!r} is invalid."
