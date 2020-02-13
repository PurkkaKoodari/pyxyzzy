from __future__ import annotations

import json
import re
from dataclasses import fields, replace
from functools import wraps
from json import JSONDecodeError
from logging import getLogger
from typing import Optional, Tuple, List, Callable, Union
from uuid import UUID

from websockets import WebSocketServerProtocol, ConnectionClosed

from pyxyzzy.config import NAME_REGEX
from pyxyzzy.exceptions import InvalidRequest, GameError, InvalidGameState
from pyxyzzy.game import (User, GameServer, UpdateType, Game, LeaveReason, WhiteCardID, UserID, GameCode, GameOptions,
                          RoundID)
from pyxyzzy.utils import FunctionRegistry

LOGGER = getLogger("pyXyzzy")


def require_not_ingame(method):
    @wraps(method)
    def _wrapped(self: GameConnection, content: dict):
        if self.user.game:
            raise InvalidGameState("user_in_game", "user already in game")
        return method(self, content)

    return _wrapped


def require_ingame(method):
    @wraps(method)
    def _wrapped(self: GameConnection, content: dict):
        if not self.user.game:
            raise InvalidGameState("user_not_in_game", "user not in game")
        return method(self, content)

    return _wrapped


def require_czar(method):
    @wraps(method)
    @require_ingame
    def _wrapped(self: GameConnection, content: dict):
        if self.user.player != self.user.game.card_czar:
            raise InvalidGameState("user_not_czar", "you are not the card czar")
        return method(self, content)

    return _wrapped


def require_host(method):
    @wraps(method)
    @require_ingame
    def _wrapped(self: GameConnection, content: dict):
        if self.user.player != self.user.game.host:
            raise InvalidGameState("user_not_host", "you are not the host")
        return method(self, content)

    return _wrapped


def connection_factory(server: GameServer):
    async def handler(websocket: WebSocketServerProtocol, _path: str) -> None:
        await GameConnection(websocket, server).handler()

    return handler


class GameConnection:
    handlers: FunctionRegistry[str, Callable[[GameConnection, dict], Optional[dict]]] = FunctionRegistry()

    websocket: WebSocketServerProtocol

    user: Optional[User] = None
    server: GameServer

    def __init__(self, websocket: WebSocketServerProtocol, server: GameServer):
        self.websocket = websocket
        self.server = server

    async def handler(self):
        LOGGER.info("New connection from %s", self.websocket.remote_address)
        try:
            async for message in self.websocket:
                await self._handle_message(message)
        except InvalidRequest as ex:
            await self.websocket.close(1003, ex.description)
        except ConnectionClosed:
            pass
        finally:
            LOGGER.info("Connection closed for %s with code %s",
                        self.websocket.remote_address, self.websocket.close_code)
            if self.user:
                self.user.disconnected(self)

    async def send_json(self, data: dict):
        if self.websocket.open:
            await self.websocket.send(json.dumps(data))

    async def replaced(self):
        await self.send_json({
            "disconnect": "connected_elsewhere"
        })
        await self.websocket.close()

    async def _handle_message(self, message: Union[str, bytes]):
        if not isinstance(message, str):
            raise InvalidRequest("only text JSON messages allowed")
        try:
            parsed = json.loads(message)
        except JSONDecodeError:
            raise InvalidRequest("invalid JSON")
        if not isinstance(parsed, dict):
            raise InvalidRequest("only JSON objects allowed")

        try:
            action = parsed["action"]
            call_id = parsed["call_id"]
        except KeyError:
            raise InvalidRequest("action or call_id missing or invalid")
        if not isinstance(action, str) or not isinstance(call_id, (str, int, float)):
            raise InvalidRequest("action or call_id missing or invalid")

        result = self._handle_request(action, call_id, parsed)

        await self.websocket.send(json.dumps(result))

    def _handle_request(self, action: str, call_id: Union[str, int, float], content: dict):
        # noinspection PyBroadException
        try:
            if not self.user and action != "authenticate":
                raise GameError("not_authenticated", "must authenticate first")

            try:
                handler = self.handlers[action]
            except KeyError:
                raise InvalidRequest("invalid action")

            call_result = handler(self, content) or {}
            return {
                "call_id": call_id,
                "error": None,
                **call_result
            }
        except GameError as ex:
            # force a full resync if that will likely be useful
            if isinstance(ex, InvalidGameState) and self.user and self.user.game:
                LOGGER.error("%s hit an error likely caused by desync", self.user, exc_info=True)
                self.user.game.send_updates(full_resync=True, to=self.user.player)
            return {
                "call_id": call_id,
                "error": ex.code,
                "description": ex.description
            }
        except Exception:
            LOGGER.error("Internal uncaught exception in WebSocket handler.", exc_info=True)
            return {
                "call_id": call_id,
                "error": "internal_error",
                "description": "internal error"
            }

    @handlers.register("authenticate")
    def _handle_authenticate(self, content: dict):
        if self.user:
            raise GameError("already_authenticated", "already authenticated")
        if "id" in content and "token" in content:
            try:
                user_id = UUID(hex=content["id"])
            except (KeyError, ValueError):
                raise InvalidRequest("invalid id")
            try:
                user = self.server.users.find_by("id", user_id)
            except KeyError:
                raise GameError("user_not_found", "user not found")
            if user.token != content["token"]:
                raise GameError("invalid_token", "invalid token")
            self.user = user
            self.user.reconnected(self)
        elif "name" in content:
            name = content["name"]
            if not isinstance(name, str) or name != name.strip() or not re.match(NAME_REGEX, name):
                raise InvalidRequest("invalid name")
            if self.server.users.exists("name", name.lower()):
                raise GameError("name_in_use", "name already in use")
            user = User(name, self.server, self)
            self.server.add_user(user)
            self.user = user
        else:
            raise InvalidRequest("missing id/token or name")

        LOGGER.info("%s authenticated as %s", self.websocket.remote_address, self.user)
        result = {
            "id": str(user.id),
            "token": user.token,
            "name": user.name,
            "in_game": user.game is not None
        }
        if user.game:
            user.game.send_updates(full_resync=True, to=user.player)
        return result

    @handlers.register("log_out")
    def _handle_log_out(self, _: dict):
        self.server.remove_user(self.user, LeaveReason.leave)
        self.user = None

    @handlers.register("game_list")
    def _handle_game_list(self, _: dict):
        return {
            "games": [game.game_list_json() for game in self.server.games if game.options.public]
        }

    @handlers.register("create_game")
    @require_not_ingame
    def _handle_create_game(self, _: dict):
        options = GameOptions(game_title=f"{self.user.name}'s game")
        game = Game(self.server, options)
        game.add_player(self.user)
        self.server.add_game(game)

    @handlers.register("join_game")
    @require_not_ingame
    def _handle_join_game(self, content: dict):
        try:
            game_code = GameCode(content["code"])
            if not isinstance(game_code, str):
                raise InvalidRequest("invalid code")
        except KeyError:
            raise InvalidRequest("invalid code")
        try:
            game = self.server.games.find_by("code", game_code)
        except KeyError:
            raise GameError("game_not_found", "game not found")

        if game.options.password:
            password = content.get("password", "")
            if not password:
                raise GameError("password_required", "a password is required to join the game")
            if game.options.password != password:
                raise GameError("password_incorrect", "incorrect password")

        game.add_player(self.user)

    @handlers.register("leave_game")
    @require_ingame
    def _handle_leave_game(self, _: dict):
        self.user.game.remove_player(self.user.player, LeaveReason.leave)

    @handlers.register("kick_player")
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

    @handlers.register("game_options")
    @require_host
    def _handle_game_options(self, content: dict):
        changes = {}
        for field in fields(GameOptions):
            if field.name in content:
                if self.user.game.game_running and field.name not in GameOptions.updateable_ingame:
                    raise InvalidGameState("option_locked", f"{field.name} can't be changed while the game is ongoing")
                value = content[field.name]
                if field.name == "card_packs":
                    raise InvalidRequest("card pack setting not implemented")
                changes[field.name] = value
        self.user.game.options = replace(self.user.game.options, **changes)

    @handlers.register("start_game")
    @require_host
    def _handle_start_game(self, content: dict):
        pass  # TODO implement game start

    @handlers.register("stop_game")
    @require_host
    def _handle_stop_game(self, content: dict):
        pass  # TODO implement game stop

    @handlers.register("play_white")
    @require_ingame
    def _handle_play_white(self, content: dict):
        cards: List[Tuple[WhiteCardID, Optional[str]]] = []
        try:
            round_id = RoundID(UUID(hex=content["round"]))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid round")
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

        self.user.game.play_white_cards(round_id, self.user.player, cards)

    @handlers.register("choose_winner")
    @require_czar
    def _handle_choose_winner(self, content: dict):
        try:
            round_id = RoundID(UUID(hex=content["round"]))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid round")
        try:
            winner_id = WhiteCardID(UUID(hex=content["winner"]))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid winner")

        self.user.game.choose_winner(round_id, winner_id)

    @handlers.register("chat")
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
