from __future__ import annotations

import re
from asyncio import Queue
from functools import wraps
from logging import getLogger
from typing import Optional, Tuple, List
from uuid import UUID

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from game_server.config import NAME_REGEX
from game_server.exceptions import InvalidRequest, GameError, InvalidGameState
from game_server.game import User, GameServer, UpdateType, Game, LeaveReason, WhiteCardID, UserID

LOGGER = getLogger("pyXyzzy")


def require_not_ingame(method):
    @wraps(method)
    def _wrapped(self: GameConsumer, content: dict):
        if self.user.game:
            raise InvalidGameState("user_in_game", "user already in game")

    return _wrapped


def require_ingame(method):
    @wraps(method)
    def _wrapped(self: GameConsumer, content: dict):
        if not self.user.game:
            raise InvalidGameState("user_not_in_game", "user not in game")

    return _wrapped


def require_czar(method):
    @wraps(method)
    @require_ingame
    def _wrapped(self: GameConsumer, content: dict):
        if self.user.player != self.user.game.card_czar:
            raise InvalidGameState("user_not_czar", "you are not the card czar")
        return method(self, content)

    return _wrapped


def require_host(method):
    @wraps(method)
    @require_ingame
    def _wrapped(self: GameConsumer, content: dict):
        if self.user.player != self.user.game.host:
            raise InvalidGameState("user_not_host", "you are not the host")
        return method(self, content)

    return _wrapped


class GameConsumer(AsyncJsonWebsocketConsumer):

    user: Optional[User] = None
    server: GameServer
    queue: Queue[dict]

    async def receive_json(self, content, **kwargs):
        try:
            action = content["action"]
            call_id = content["call_id"]
        except KeyError:
            raise ValueError("action or call_id missing or invalid")
        if not isinstance(action, str) or not isinstance(call_id, (str, int, float)):
            raise ValueError("action or call_id missing or invalid")

        if not self.user and action != "authenticate":
            raise ValueError("first call must be authenticate")
        try:

            result = {
                "call": call_id,
                "error": None
            }
            result.update(self._handle_authenticate(content))

            self.queue.put_nowait(result)
        except GameError as ex:
            self.queue.put_nowait({
                "call": call_id,
                "error": ex.code,
                "description": ex.description
            })
        except Exception:
            LOGGER.error("Internal uncaught exception.", exc_info=True)
            self.queue.put_nowait({
                "call": call_id,
                "error": "internal_error",
                "description": None
            })

    def _handle_authenticate(self, content: dict):
        if "id" in content and "token" in content:
            try:
                user = self.server.users.find_by("id", UUID(hex=content["id"]))
            except (ValueError, KeyError):
                raise InvalidRequest("user not found")
            if user.token != content["token"]:
                raise InvalidRequest("invalid token")
            self.user = user
            self.user.reconnected(self)
        elif "name" in content:
            name = content["name"]
            if not isinstance(name, str) or name != name.strip() or not re.match(NAME_REGEX, name):
                raise InvalidRequest("invalid name")
            if self.server.users.find_by("name", name):
                raise InvalidRequest("name already in use")
            user = User(name, self.server, self)
            self.server.add_user(user)
            self.user = user
        else:
            raise InvalidRequest("missing parameters")
        result = {
            "id": str(user.id),
            "token": user.token
        }
        if user.game:
            result["game"] = user.game
            user.game.send_updates(UpdateType.game, UpdateType.players, UpdateType.hand, UpdateType.options,
                                   to=user.player)
        return result

    @require_not_ingame
    def _handle_create_game(self, content: dict):
        game = Game(self.server)
        game.add_player(self.user)
        self.server.add_game(game)

    @require_not_ingame
    def _handle_join_game(self, content: dict):
        pass  # TODO implement game join

    @require_ingame
    def _handle_leave_game(self, content: dict):
        self.user.game.remove_player(self.user.player, LeaveReason.leave)

    @require_host
    def _handle_kick_player(self, content: dict):
        try:
            user_id = UserID(UUID(hex=content["user"]))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid user")

        if user_id == self.user.id:
            raise InvalidGameState("self_kick", "can't kick yourself")
        try:
            player = self.user.game.players.find_by("id", user_id)
        except KeyError:
            raise InvalidGameState("player_not_in_game", "the player is not in the game")

        self.user.game.remove_player(player, LeaveReason.host_kick)

    @require_host
    def _handle_game_options(self, content: dict):
        pass  # TODO implement options changing

    @require_host
    def _handle_start_game(self, content: dict):
        pass  # TODO implement game start

    @require_host
    def _handle_stop_game(self, content: dict):
        pass  # TODO implement game stop

    @require_ingame
    def _handle_play_white(self, content: dict):
        cards: List[Tuple[WhiteCardID, Optional[str]]] = []
        try:
            input_cards = content["cards"]
            for input_card in input_cards:
                slot_id = WhiteCardID(UUID(hex=input_card["id"]))
                text = input_card.get("text")
                if text is not None and (not isinstance(text, str) or not text.strip()):
                    raise InvalidRequest("invalid cards")
                cards.append((slot_id, text.strip()))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid cards")

        self.user.game.play_white_cards(self.user.player, cards)

    @require_czar
    def _handle_choose_winner(self, content: dict):
        try:
            winner_id = WhiteCardID(UUID(hex=content["winner"]))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid winner")

        self.user.game.choose_winner(winner_id)

    @require_ingame
    def _handle_chat(self, content: dict):
        # TODO rate limiting, spam blocking
        try:
            text = content["text"]
            if not isinstance(text, str) or not text.strip():
                raise InvalidRequest("invalid text")
        except KeyError:
            raise InvalidRequest("invalid text")

        self.user.game.send_event({
            "type": "chat_message",
            "text": text
        })

    async def disconnect(self, code):
        if self.user is not None:
            self.user.disconnected()
