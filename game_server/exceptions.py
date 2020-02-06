from dataclasses import dataclass


@dataclass
class GameError(Exception):
    code: str
    description: str


class InvalidRequest(GameError):
    pass


class InvalidGameState(GameError):
    pass
