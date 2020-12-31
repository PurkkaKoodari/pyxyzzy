from __future__ import annotations

import json
from abc import ABC, abstractmethod
from asyncio import get_event_loop
from asyncio.futures import Future
from dataclasses import fields, replace
from functools import wraps
from json import JSONDecodeError
from logging import getLogger
from typing import Optional, Tuple, List, Callable, Union
from uuid import UUID

from websockets import WebSocketServerProtocol, ConnectionClosed, serve

from pyxyzzy import UI_VERSION
from pyxyzzy.api import ApiAction
from pyxyzzy.config import config
from pyxyzzy.database import db_connection
from pyxyzzy.exceptions import InvalidRequest, GameError, InvalidGameState
from pyxyzzy.game import (User, GameServer, Game, LeaveReason, WhiteCardID, UserID, GameCode, GameOptions, RoundID,
                          CardPackID)
from pyxyzzy.utils import FunctionRegistry, create_task_log_errors
from pyxyzzy.utils.config import ConfigError

LOGGER = getLogger(__name__)


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
        await WebSocketGameConnection(websocket, server).handler()

    return handler


async def run_server(stop_condition: Future):
    db_connection.init(config.database.file)
    game_server = GameServer()
    await get_event_loop().run_in_executor(None, game_server.load_local_packs)

    if config.debug.enabled and config.debug.bots.count > 0:
        from pyxyzzy.test.bot import run_bots
        create_task_log_errors(run_bots(game_server, stop_condition))

    async with serve(connection_factory(game_server), config.server.host, config.server.port):
        await stop_condition


class GameConnection(ABC):
    handlers: FunctionRegistry[ApiAction, Callable[[GameConnection, dict], Optional[dict]]] = FunctionRegistry()

    remote_addr: str

    handshaked: bool = False
    user: Optional[User] = None
    server: GameServer

    def __init__(self, server: GameServer, remote_addr: str):
        self.server = server
        self.remote_addr = remote_addr

    def client_disconnected(self):
        """Called by subclasses when the client has disconnected."""
        LOGGER.info("%s disconnected", self.user or self.remote_addr)
        if self.user:
            self.user.disconnected(self)

    async def replaced(self):
        """Informs the client that another connection has been received from this user and disconnects."""
        await self.send_json_to_client({
            "disconnect": "connected_elsewhere"
        }, close=True)

    @abstractmethod
    async def send_json_to_client(self, data: dict, *, close: bool = False):
        """Sends a JSON message to the client."""

    async def receive_json_from_client(self, message: Union[str, bytes]):
        """Called by subclasses when they receive a JSON message from the client."""
        if not isinstance(message, str):
            raise InvalidRequest("only text JSON messages allowed")
        try:
            parsed = json.loads(message)
        except JSONDecodeError:
            raise InvalidRequest("invalid JSON")
        if not isinstance(parsed, dict):
            raise InvalidRequest("only JSON objects allowed")

        if not self.handshaked:
            try:
                if parsed["version"] == UI_VERSION:
                    await self.send_json_to_client({
                        "config": self.server.config_json()
                    })
                    self.handshaked = True
                else:
                    await self.send_json_to_client({
                        "error": "incorrect_version"
                    }, close=True)
                return
            except KeyError:
                raise InvalidRequest("invalid handshake")

        try:
            action = ApiAction[parsed["action"]]
            call_id = parsed["call_id"]
        except KeyError:
            raise InvalidRequest("action or call_id missing or invalid")
        if not isinstance(action, ApiAction) or not isinstance(call_id, (str, int, float)):
            raise InvalidRequest("action or call_id missing or invalid")

        result = self._handle_request(action, call_id, parsed)

        await self.send_json_to_client(result)

    def _handle_request(self, action: ApiAction, call_id: Union[str, int, float], content: dict):
        # noinspection PyBroadException
        try:
            if not self.user and action != ApiAction.authenticate:
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

    @handlers.register(ApiAction.authenticate)
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
            if not isinstance(name, str) or not config.users.username.is_valid_name(name):
                raise InvalidRequest("invalid name")
            if self.server.users.exists("name", name.lower()):
                raise GameError("name_in_use", "name already in use")
            user = User(name, self.server, self)
            self.server.add_user(user)
            self.user = user
        else:
            raise InvalidRequest("missing id/token or name")

        LOGGER.info("%s authenticated as %s", self.remote_addr, self.user)
        result = {
            "id": str(user.id),
            "token": user.token,
            "name": user.name,
            "in_game": user.game is not None
        }
        if user.game:
            user.game.send_updates(full_resync=True, to=user.player)
        return result

    @handlers.register(ApiAction.log_out)
    def _handle_log_out(self, _: dict):
        self.server.remove_user(self.user, LeaveReason.leave)
        self.user = None

    @handlers.register(ApiAction.game_list)
    def _handle_game_list(self, _: dict):
        return {
            "games": [game.game_list_json() for game in self.server.games if game.options.public]
        }

    @handlers.register(ApiAction.create_game)
    @require_not_ingame
    def _handle_create_game(self, _: dict):
        game = Game(self.server)
        game.add_player(self.user)
        self.server.add_game(game)

    @handlers.register(ApiAction.join_game)
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
            if game.options.password.upper() != password.upper():
                raise GameError("password_incorrect", "incorrect password")

        game.add_player(self.user)

    @handlers.register(ApiAction.leave_game)
    @require_ingame
    def _handle_leave_game(self, _: dict):
        self.user.game.remove_player(self.user.player, LeaveReason.leave)

    @handlers.register(ApiAction.kick_player)
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

    @handlers.register(ApiAction.game_options)
    @require_host
    def _handle_game_options(self, content: dict):
        changes = {}
        for field in fields(GameOptions):
            if field.name in content:
                if self.user.game.game_running and field.name not in GameOptions.updateable_ingame:
                    raise InvalidGameState("option_locked", f"{field.name} can't be changed while the game is ongoing")
                value = content[field.name]
                if field.name == "card_packs":
                    try:
                        value = tuple(self.server.card_packs.find_by("id", CardPackID(UUID(uuid))) for uuid in value)
                    except (TypeError, ValueError, KeyError):
                        raise InvalidRequest("invalid card_packs list")
                changes[field.name] = value
        try:
            new_options = replace(self.user.game.options, **changes)
            self.user.game.update_options(new_options)
        except ConfigError as ex:
            raise GameError("invalid_options", str(ex)) from None

    @handlers.register(ApiAction.start_game)
    @require_host
    def _handle_start_game(self, _: dict):
        self.user.game.start_game()

    @handlers.register(ApiAction.stop_game)
    @require_host
    def _handle_stop_game(self, _: dict):
        self.user.game.stop_game()

    @handlers.register(ApiAction.play_white)
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
                if not isinstance(input_card, dict):
                    raise InvalidRequest("invalid cards")
                slot_id = WhiteCardID(UUID(hex=input_card["id"]))
                text = input_card.get("text")
                if text is not None:
                    if not (isinstance(text, str) and config.game.blank_cards.is_valid_text(text)):
                        # TODO graceful handling for disallowed text
                        raise InvalidRequest("invalid cards")
                    text = text.strip()
                cards.append((slot_id, text))
        except (KeyError, ValueError):
            raise InvalidRequest("invalid cards")

        self.user.game.play_white_cards(round_id, self.user.player, cards)

    @handlers.register(ApiAction.choose_winner)
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

    @handlers.register(ApiAction.chat)
    @require_ingame
    def _handle_chat(self, content: dict):
        # TODO rate limiting, spam blocking, blacklist
        try:
            text = content["text"]
            if not (isinstance(text, str) and config.chat.is_valid_message(text)):
                # TODO graceful handling for disallowed text
                raise InvalidRequest("invalid text")
        except KeyError:
            raise InvalidRequest("invalid text")

        self.user.game.send_event({
            "type": "chat_message",
            "player": self.user.player.to_event_json(),
            "text": text,
        })


class WebSocketGameConnection(GameConnection):
    websocket: WebSocketServerProtocol

    def __init__(self, websocket: WebSocketServerProtocol, server: GameServer):
        GameConnection.__init__(self, server, str(websocket.remote_address))
        self.websocket = websocket

    async def handler(self):
        LOGGER.info("New connection from %s", self.remote_addr)
        try:
            async for message in self.websocket:
                await self.receive_json_from_client(message)
        except InvalidRequest as ex:
            await self.websocket.close(1003, ex.description)
        except ConnectionClosed:
            pass
        finally:
            LOGGER.info("Connection closed for %s with code %s",
                        self.remote_addr, self.websocket.close_code)
            self.client_disconnected()

    async def send_json_to_client(self, data: dict, *, close: bool = False):
        if self.websocket.open:
            await self.websocket.send(json.dumps(data))
            if close:
                await self.websocket.close()
