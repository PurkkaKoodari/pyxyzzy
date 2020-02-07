from dataclasses import dataclass


@dataclass
class GameError(Exception):
    code: str
    description: str


class InvalidRequest(GameError):
    def __init__(self, description: str):
        super().__init__("invalid_request", description)


class InvalidGameState(GameError):
    pass
