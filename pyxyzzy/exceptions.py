from dataclasses import dataclass


@dataclass
class GameError(Exception):
    """Base class for errors that should be caught and reported to the user as API call errors."""
    code: str
    description: str


class InvalidRequest(GameError):
    """Used for errors where the request is invalid and the client knows it. Should never occur when using the
    correct version of the reference client.
    """
    def __init__(self, description: str):
        super().__init__("invalid_request", description)


class InvalidGameState(GameError):
    """Used for errors with an actual game's state. Usually result from desyncs."""
    pass
