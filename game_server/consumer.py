from __future__ import annotations

import re
from asyncio import Queue
from logging import getLogger
from typing import Optional
from uuid import UUID

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from game_server.config import NAME_REGEX
from game_server.exceptions import InvalidRequest, InvalidGameState
from game_server.game import User, GameServer, UpdateType

LOGGER = getLogger("pyXyzzy")


class GameConsumer(AsyncJsonWebsocketConsumer):

    user: Optional[User] = None
    server: GameServer
    queue: Queue[dict]

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict) or "action" not in content or "call" not in content:
            raise ValueError("invalid request")
        action = content["action"]
        call_id = content["call_id"]
        if not isinstance(action, str) or not isinstance(call_id, str):
            raise ValueError("invalid request")

        try:
            result = {
                "call": call_id,
                "error": None
            }

            if self.user is None:
                if action == "authenticate":
                    result.update(self._handle_authenticate(content))
                await self.close(4000)
                return

            self.queue.put_nowait(result)
        except InvalidRequest as ex:
            self.queue.put_nowait({
                "call": call_id,
                "error": "invalid_request",
                "description": str(ex)
            })
        except InvalidGameState as ex:
            self.queue.put_nowait({
                "call": call_id,
                "error": "invalid_state",
                "description": str(ex)
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
                user = self.server.users.find_by("id", UUID(content["id"]))
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

    async def disconnect(self, code):
        if self.user is not None:
            self.user.disconnected()

