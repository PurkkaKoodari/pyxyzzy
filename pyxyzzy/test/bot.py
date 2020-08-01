from __future__ import annotations

import json
from abc import ABC, abstractmethod
from asyncio import Task, create_task, Queue, Future, sleep, current_task
from asyncio.events import get_event_loop
from dataclasses import dataclass
from logging import getLogger
from random import randint, choice, normalvariate, sample
from typing import Dict, Callable, Optional, Tuple

from websockets import WebSocketClientProtocol, connect, ConnectionClosed

from pyxyzzy import UI_VERSION
from pyxyzzy.api import ApiAction
from pyxyzzy.exceptions import GameError
from pyxyzzy.game import GameServer, Game
from pyxyzzy.server import GameConnection

LOGGER = getLogger("pyXyzzy")


class BotDisconnected(Exception):
    pass


class BotConnection(ABC):
    """Base class for bot connections that provides the API call method."""

    local_addr: str

    @abstractmethod
    async def call(self, action: ApiAction, params: dict, persistent: bool = False) -> dict:
        """Performs an API call against the server via this connection."""
        pass

    async def open(self):
        """Opens the connection to the server."""
        LOGGER.info("Opening bot connection %s", self.local_addr)

    async def close(self):
        """Closes the connection to the server."""
        LOGGER.info("Closed bot connection %s", self.local_addr)


@dataclass
class ApiCall:
    future: Future[dict]
    persistent: bool

    def __post_init__(self):
        if self.persistent:
            raise NotImplementedError("Persistent calls are not implemented")


class JsonBotConnection(BotConnection, ABC):
    """Base class for bot connections that use the WebSocket JSON message format."""

    bot: BotBase
    calls: Dict[int, ApiCall]
    next_id: int = 0

    def __init__(self, bot: BotBase):
        self.bot = bot
        self.calls = {}

    @abstractmethod
    async def send_json_to_server(self, data: dict):
        """Sends a JSON message to the server."""
        pass

    def receive_json_from_server(self, data: dict):
        """Handles a JSON message from the server."""
        if "call_id" in data:
            call = self.calls[data["call_id"]]
            del self.calls[data["call_id"]]
            if data["error"] is not None:
                call.future.set_exception(GameError(data["error"], data["description"]))
            else:
                call.future.set_result(data)
        else:
            if "events" in data:
                for event in data["events"]:
                    self.bot.handle_event(event)
            self.bot.handle_update(data)

    async def open(self):
        await self.bot.authenticate()
        await super().open()

    async def close(self):
        await super().close()
        self.closed()

    def closed(self):
        """Called by subclasses if the connection is closed unexpectedly. ``close()`` also calls this.

        The default implementation just fails all non-persistent calls with ``BotDisconnected`` errors and calls
        ``bot.disconnected()``.
        """
        for call_id, call in self.calls.items():
            if not call.persistent:
                del self.calls[call_id]
                call.future.set_exception(BotDisconnected())
        self.bot.disconnected()

    async def call(self, action: ApiAction, params: dict = {}, persistent: bool = False) -> dict:
        self.next_id += 1
        fut = get_event_loop().create_future()
        self.calls[self.next_id] = ApiCall(fut, persistent)
        await self.send_json_to_server({
            "action": action.name,
            "call_id": self.next_id,
            **params
        })
        return await fut


class DirectBotConnection(GameConnection, JsonBotConnection):
    recv_dispatcher_task: Task
    send_dispatcher_task: Task
    recv_queue: Queue[dict]
    send_queue: Queue[dict]

    def __init__(self, server: GameServer, bot: BotBase):
        GameConnection.__init__(self, server, f"<direct {id(self)}>")
        JsonBotConnection.__init__(self, bot)
        self.send_queue = Queue()
        self.recv_queue = Queue()
        self.handshaked = True

    async def send_dispatcher(self):
        while True:
            message = await self.send_queue.get()
            await self._handle_message(json.dumps(message))

    async def recv_dispatcher(self):
        while True:
            message = await self.recv_queue.get()
            self.receive_json_from_server(message)

    async def send_json_to_server(self, data: dict):
        self.send_queue.put_nowait(data)

    async def open(self):
        self.local_addr = f"<direct {id(self)}>"
        await super().open()
        self.send_dispatcher_task = create_task(self.send_dispatcher())
        self.recv_dispatcher_task = create_task(self.recv_dispatcher())

    async def close(self):
        self.send_dispatcher_task.cancel()
        self.recv_dispatcher_task.cancel()
        await super().close()

    async def send_json_to_client(self, data: dict, *, close: bool = False):
        self.recv_queue.put_nowait(data)
        if close:
            await self.close()


class WebSocketBotConnection(JsonBotConnection):
    url: str
    connection: WebSocketClientProtocol

    def __init__(self, url: str, bot: BotBase):
        JsonBotConnection.__init__(self, bot)
        self.url = url

    async def send_json_to_server(self, data: dict):
        await self.connection.send(json.dumps(data))

    async def open(self):
        self.connection = await connect(self.url)
        self.local_addr = str(self.connection.local_address)
        # perform handshake
        await self.connection.send({
            "version": UI_VERSION
        })
        config_response = json.loads(await self.connection.recv())
        assert "config" in config_response, "connection handshake failed"
        # continue with connection
        await super().open()
        create_task(self.handler())

    async def handler(self):
        try:
            async for message in self.connection:
                self.receive_json_from_server(json.loads(message))
        except ConnectionClosed:
            self.closed()

    async def close(self):
        await self.connection.close()
        await super().close()


ConnFactory = Callable[[], BotConnection]


class BotBase:
    connection_factory: ConnFactory
    connection: Optional[BotConnection]
    credentials: Optional[Tuple[str, str]] = None
    player_id: Optional[str] = None

    # TODO: handle persistent calls properly or remove them altogether

    def __init__(self, connection_factory: ConnFactory):
        self.connection_factory = connection_factory

    async def connect(self) -> None:
        try:
            self.connection = self.connection_factory()
            await self.connection.open()
        except Exception:
            self.connection = None
            raise

    async def disconnect(self) -> None:
        if self.connection is not None:
            await self.connection.close()

    def disconnected(self) -> None:
        self.connection = None

    async def authenticate(self) -> None:
        # default authentication algorithm
        if self.credentials:
            try:
                await self.connection.call(ApiAction.authenticate, {
                    "id": self.credentials[0],
                    "token": self.credentials[1]
                })
            except GameError as ex:
                if ex.code != "user_not_found":
                    raise
                self.credentials = None
        while True:
            username = self.generate_username()
            try:
                result = await self.connection.call(ApiAction.authenticate, {
                    "username": username
                })
                self.credentials = (result["id"], result["token"])
                self.player_id = result["id"]
                return
            except GameError as ex:
                if ex.code == "name_in_use":
                    continue
                raise

    def generate_username(self) -> str:
        return f"{self.__class__.__name__}{randint(100000, 999999)}"

    def handle_update(self, update: dict) -> None:
        pass

    def handle_event(self, event: dict) -> None:
        pass


class RandomPlayBot(BotBase):
    game: Game
    play_speed: Tuple[float, float]

    finished: bool = False

    # state variables extracted from updates
    game_state: str = "not_in_game"
    round_id: Optional[str]
    card_czar_id: Optional[str]
    pick_count: Optional[int]
    hand: list
    white_cards: Optional[list]

    # the currently scheduled play action and playing state, always in sync
    play_task: Optional[Task] = None
    play_state: str = "not_played"

    def __init__(self,
                 connection_factory: ConnFactory,
                 game: Game,
                 play_speed: Tuple[float, float] = (5.0, 2.0)):
        super().__init__(connection_factory)
        self.game = game
        self.play_speed = play_speed

    def disconnected(self):
        self.quit()
        super().disconnected()

    def quit(self):
        self.finished = True
        self.cancel_play()
        create_task(self.disconnect())

    def cancel_play(self):
        if self.play_task is not None:
            self.play_task.cancel()
            self.play_task = None
            self.play_state = "not_played"

    async def authenticate(self) -> None:
        try:
            await super().authenticate()
            await self.connection.call(ApiAction.join_game, {
                "code": self.game.code,
                "password": self.game.options.password
            })
        except GameError:
            LOGGER.error("Authentication failed, quitting bot", exc_info=True)
            self.quit()

    def handle_update(self, update: dict):
        prev_game_state = self.game_state

        if self.finished:
            return
        if "game" in update and not update["game"]:
            # removed from game, our job here is done
            self.quit()
            return
        if "game" in update:
            self.game_state = update["game"]["state"]
            if update["game"]["current_round"]:
                self.pick_count = update["game"]["current_round"]["black_card"]["pick_count"]
                self.white_cards = update["game"]["current_round"]["white_cards"]
                self.round_id = update["game"]["current_round"]["id"]
                self.card_czar_id = update["game"]["current_round"]["card_czar"]
            else:
                self.white_cards = self.pick_count = self.round_id = self.card_czar_id = None
        if "hand" in update:
            self.hand = update["hand"]

        # reset play state after any game state changes
        if self.game_state != prev_game_state:
            self.cancel_play()
            self.play_state = "not_played"
        # schedule playing as player or card czar if necessary
        if self.game_state == "playing" and self.play_state == "not_played" and self.player_id != self.card_czar_id:
            self.play_state = "playing"
            self.play_task = create_task(self.play_white())
        if self.game_state == "judging" and self.play_state == "not_played" and self.player_id == self.card_czar_id:
            self.play_state = "playing"
            self.play_task = create_task(self.play_czar())

    async def play_white(self):
        await sleep(max(0.1, normalvariate(*self.play_speed)))
        cards = sample(self.hand, self.pick_count)
        try:
            await self.connection.call(ApiAction.play_white, {
                "round": self.round_id,
                "cards": [card["id"] for card in cards]
            })
        except GameError:
            LOGGER.error("Playing white cards failed, quitting bot", exc_info=True)
            self.quit()
            return
        if self.play_task == current_task():
            self.play_state = "played"
            self.play_task = None

    async def play_czar(self):
        await sleep(max(0.1, normalvariate(*self.play_speed)))
        winner = choice(self.white_cards)[0]["id"]
        try:
            await self.connection.call(ApiAction.choose_winner, {
                "round": self.round_id,
                "winner": winner
            })
        except GameError:
            LOGGER.error("Choosing winner failed, quitting bot", exc_info=True)
            self.quit()
            return
        if self.play_task == current_task():
            self.play_state = "played"
            self.play_task = None
