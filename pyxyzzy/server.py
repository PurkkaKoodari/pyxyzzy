from __future__ import annotations

import json
import re
from json import JSONDecodeError
from logging import getLogger
from typing import Optional
from uuid import UUID

from autobahn.asyncio import WebSocketServerProtocol

from pyxyzzy.config import NAME_REGEX
from pyxyzzy.exceptions import InvalidRequest, InvalidGameState
from pyxyzzy.models import User, GameServer

LOGGER = getLogger("pyXyzzy")


class GameSocketProtocol(WebSocketServerProtocol):

    user: Optional[User] = None
    server: GameServer

    def send_json_message(self, payload):
        # TODO check closed?
        self.sendMessage(json.dumps(payload).encode())

    async def onMessage(self, payload, is_binary):
        if is_binary:
            self.sendClose(1003, "only text payloads allowed")
            return
        try:
            message = json.loads(payload.decode())
        except (UnicodeError, JSONDecodeError):
            self.sendClose(1003, "invalid JSON")
            return
        if not isinstance(message, dict) or "action" not in message or "call" not in message:
            self.sendClose(1003, "invalid request")
            return
        action = message["action"]
        call_id = message["call_id"]
        if not isinstance(action, str) or not isinstance(call_id, str):
            self.sendClose(1003)
            return

        try:
            result = {
                "call_id": call_id,
                "error": None
            }

            if self.user is None:
                if action == "authenticate":
                    result.update(self._handle_authenticate(message))
                self.sendClose(4000)
                return

            self.send_json_message(result)
        except InvalidRequest as ex:
            self.send_json_message({
                "call_id": call_id,
                "error": "invalid_request",
                "description": str(ex)
            })
        except InvalidGameState as ex:
            self.send_json_message({
                "call_id": call_id,
                "error": "invalid_state",
                "description": str(ex)
            })
        except Exception:
            LOGGER.error("Internal uncaught exception.", exc_info=True)
            self.send_json_message({
                "call_id": call_id,
                "error": "internal_error",
                "description": None
            })

    def _handle_authenticate(self, message: dict):
        if "id" in message and "token" in message:
            try:
                user = self.server.users_by_id[UUID(message["id"])]
            except (ValueError, KeyError):
                raise InvalidRequest("user not found")
            if user.token != message["token"]:
                raise InvalidRequest("invalid token")
            self.user = user
        elif "name" in message:
            name = message["name"]
            if not isinstance(name, str) or not re.match(NAME_REGEX, name):
                raise InvalidRequest("invalid name")
            if name.lower() in self.server.users_by_name:
                raise InvalidRequest("name already in use")
            user = User(name)
            self.server.add_user(user)
            self.user = user
        else:
            raise InvalidRequest("missing parameters")
        return {
            "id": user.id,
            "token": user.token
        }
        # TODO rejoin game!!!

    def onClose(self, was_clean, code, reason):
        if self.user is not None:
            self.user.disconnected()

