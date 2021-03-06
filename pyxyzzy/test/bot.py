from __future__ import annotations

import json
from abc import ABC, abstractmethod
from asyncio import Task, Queue, Future, sleep, shield
from asyncio.events import get_event_loop
from dataclasses import dataclass
from logging import getLogger
from random import randint, choice, sample, Random
from typing import Dict, Callable, Optional, Tuple, Awaitable, List, Set

from websockets import WebSocketClientProtocol, connect, ConnectionClosed

from pyxyzzy import UI_VERSION
from pyxyzzy.api import ApiAction
from pyxyzzy.config import config
from pyxyzzy.exceptions import GameError
from pyxyzzy.game import GameServer
from pyxyzzy.server import GameConnection
from pyxyzzy.utils import create_task_log_errors

LOGGER = getLogger(__name__)


class BotDisconnected(Exception):
    """Raised on API call futures when the bot disconnects before receiving a response."""


@dataclass
class ApiCall:
    future: Future[dict]
    persistent: bool

    def __post_init__(self):
        if self.persistent:
            raise NotImplementedError("Persistent calls are not implemented")


class BotConnection(ABC):
    """Base class for bot connections that use the WebSocket JSON message format."""

    bot: BotBase
    local_addr: str
    server_config: dict
    calls: Dict[int, ApiCall]
    next_id: int = 0
    failed: bool = False

    def __init__(self, bot: BotBase):
        self.bot = bot
        self.calls = {}

    @abstractmethod
    async def send_json_to_server(self, data: dict):
        """Sends a JSON message to the server."""

    def receive_json_from_server(self, data: dict):
        """Called by subclasses when they receive a JSON message from the server."""
        if self.failed:
            return
        try:
            if "call_id" in data:
                call = self.calls.pop(data["call_id"])
                if data["error"] is not None:
                    call.future.set_exception(GameError(data["error"], data["description"]))
                else:
                    call.future.set_result(data)
            else:
                if "events" in data:
                    for event in data["events"]:
                        self.bot.handle_event(event)
                self.bot.handle_update(data)
        except Exception:
            LOGGER.error("Error handling message from server to bot, closing connection", exc_info=True)
            self.failed = True
            create_task_log_errors(self.close())

    async def open(self):
        """Opens the connection to the server.

        The bot will be connected and authenticated when this coroutine completes.

        Subclasses should override this method and call the superclass implementation when the underlying channel is
        ready (i.e. ``send_json_to_server`` can be called). ``local_addr`` and ``server_config`` must be set when this
        method is called.
        """
        await self.bot.authenticate()
        LOGGER.info("Opening bot connection %s", self.local_addr)

    async def close(self) -> None:
        """Closes the connection to the server.

        Subclasses should override this method to close their underlying channels. ``local_addr`` must be set when this
        method is called.
        """
        LOGGER.info("Closed bot connection %s", self.local_addr)
        self.closed()

    def closed(self):
        """Called by subclasses if the connection is closed unexpectedly. ``close()`` also calls this.

        The default implementation fails all non-persistent calls with ``BotDisconnected`` errors and calls
        ``bot.disconnected()``.
        """
        for call_id, call in list(self.calls.items()):
            if not call.persistent:
                del self.calls[call_id]
                call.future.set_exception(BotDisconnected())
        self.bot.disconnected()

    async def call(self, action: ApiAction, params: dict = {}, persistent: bool = False) -> dict:
        """Performs an API call against the server via this connection."""
        self.next_id += 1
        fut = get_event_loop().create_future()
        self.calls[self.next_id] = ApiCall(fut, persistent)
        await shield(self.send_json_to_server({
            "action": action.name,
            "call_id": self.next_id,
            **params
        }))
        # even if the action causing this call is cancelled, don't cancel the future as it causes errors
        return await shield(fut)


class DirectBotConnection(GameConnection, BotConnection):
    """A connection that uses two in-memory queues to emulate a websocket connection."""

    recv_dispatcher_task: Task
    send_dispatcher_task: Task
    recv_queue: Queue[dict]
    send_queue: Queue[dict]

    def __init__(self, server: GameServer, bot: BotBase):
        GameConnection.__init__(self, server, f"<direct {id(self)}>")
        BotConnection.__init__(self, bot)
        self.send_queue = Queue()
        self.recv_queue = Queue()
        self.handshaked = True

    async def _send_dispatcher(self):
        while True:
            message = await self.send_queue.get()
            await self.receive_json_from_client(json.dumps(message))

    async def _recv_dispatcher(self):
        while True:
            message = await self.recv_queue.get()
            self.receive_json_from_server(message)

    async def send_json_to_server(self, data: dict):
        self.send_queue.put_nowait(data)

    async def open(self):
        self.local_addr = f"<direct {id(self)}>"
        self.server_config = self.server.config_json()
        self.send_dispatcher_task = create_task_log_errors(self._send_dispatcher())
        self.recv_dispatcher_task = create_task_log_errors(self._recv_dispatcher())
        await super().open()

    async def close(self):
        self.send_dispatcher_task.cancel()
        self.recv_dispatcher_task.cancel()
        self.client_disconnected()
        await super().close()

    async def send_json_to_client(self, data: dict, *, close: bool = False):
        self.recv_queue.put_nowait(data)
        if close:
            await self.close()


class WebSocketBotConnection(BotConnection):
    """A connection that uses a real websocket for connecting to the server."""

    url: str
    connection: WebSocketClientProtocol

    def __init__(self, url: str, bot: BotBase):
        BotConnection.__init__(self, bot)
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
        self.server_config = config_response["config"]
        # continue with connection
        await super().open()
        create_task_log_errors(self._recv_dispatcher())

    async def _recv_dispatcher(self):
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
    """Base class for bots to use for testing.

    Provides authentication and handles updates with no-ops.
    """
    connection_factory: ConnFactory
    connection: Optional[BotConnection] = None
    authenticated: bool = False
    credentials: Optional[Tuple[str, str]] = None
    username: Optional[str] = None
    player_id: Optional[str] = None

    # TODO: handle persistent calls properly or remove them altogether

    def __init__(self, connection_factory: ConnFactory):
        self.connection_factory = connection_factory

    def __str__(self):
        if self.authenticated:
            return f"<{type(self).__name__} {self.username} [{self.player_id}]>"
        return f"<{type(self).__name__} [unauthenticated {id(self)}]>"

    async def connect(self) -> None:
        """Opens a connection from the connection factory."""
        try:
            self.authenticated = False
            self.connection = self.connection_factory()
            await self.connection.open()
        except Exception:
            LOGGER.error("Bot failed to connect", exc_info=True)
            await self.disconnect()

    async def disconnect(self) -> None:
        """Logs out if authenticated and closes the bot's connection if one is open."""
        try:
            if self.connection and self.authenticated:
                await self.connection.call(ApiAction.log_out)
        except GameError:
            LOGGER.warning("Logging out failed", exc_info=True)
        finally:
            if self.connection:
                await self.connection.close()

    def disconnected(self) -> None:
        """Called by the connection when it closes.

        Subclasses should not override this method, instead override ``handle_disconnected()``.
        """
        self.connection = None
        self.handle_disconnected()

    async def authenticate(self) -> None:
        """Called by the connection to perform authentication.

        Subclasses should not override this method, instead override ``perform_authentication()``.
        """
        await self.perform_authentication()
        self.authenticated = True
        self.handle_authenticated()

    async def perform_authentication(self) -> None:
        """Performs authentication and sets ``username`` and ``uuid``.

        The default algorithm attempts to reconnect if possible and otherwise logs in with a random name. Subclasses
        may override this method to implement a different algorithm.
        """
        # attempt reconnection
        if self.credentials:
            try:
                result = await self.connection.call(ApiAction.authenticate, {
                    "id": self.credentials[0],
                    "token": self.credentials[1]
                })
                self.player_id = result["id"]
                self.username = result["name"]
            except GameError as ex:
                if ex.code != "user_not_found":
                    raise
                self.credentials = None
            else:
                return
        # login with a random username
        while True:
            username = self.generate_username()
            try:
                result = await self.connection.call(ApiAction.authenticate, {
                    "name": username
                })
                self.credentials = (result["id"], result["token"])
                self.player_id = result["id"]
                self.username = result["name"]
            except GameError as ex:
                # stop on first error, except for username collisions
                if ex.code == "name_in_use":
                    continue
                raise
            else:
                return

    def generate_username(self) -> str:
        """Generates a username for the bot."""
        return f"{self.__class__.__name__}{randint(100000, 999999)}"

    def handle_authenticated(self) -> None:
        """Called by ``authenticate()`` when authentication completes.

        In this handler bots might, for example, join games.
        """

    def handle_disconnected(self) -> None:
        """Called when the bot has been disconnected.

        In this handler bots might cancel tasks or attempt to reconnect by scheduling a call to ``connect()``. Inspect
        ``self.authenticated`` to see if the connection was authenticated when disconnected.
        """

    def handle_update(self, update: dict) -> None:
        """Called when an update is received."""

    def handle_event(self, event: dict) -> None:
        """Called when an event is received."""

    @staticmethod
    async def play_sleep() -> None:
        await sleep(max(0.1, config.debug.bots.play_speed.sample()))


def _target_game_size(game_code: str) -> int:
    """Determines the number of players bots will attempt to put in a single game.

    Uses the game code as a random seed to ensure that games will have randomized number of players but all bots agree
    on it.
    """
    var = min(int(Random(game_code.encode()).expovariate(0.6)), 6)
    return config.debug.bots.game_size + var


class RandomPlayBot(BotBase):
    """Default bot class used by the debug.bots option.

    Creates or joins public games and plays random cards.
    """

    finished: bool = False

    # state variables extracted from updates
    game_state: str = "not_in_game"
    game_join_complete: bool = False
    updates_received: Set[str] = set()

    is_host: bool
    game_code: str
    game_options: dict
    players_in_game: int

    round_id: Optional[str]
    card_czar_id: Optional[str]
    pick_count: Optional[int]
    white_cards: Optional[list]
    hand: list

    # the currently scheduled play action and playing state, always in sync
    _action: Tuple[str, Optional[Task]] = ("not_acted", None)

    def __init__(self, connection_factory: ConnFactory):
        super().__init__(connection_factory)

    @property
    def action_state(self):
        """A string describing the current state of the bot."""
        return self._action[0]

    @property
    def action_task(self):
        """The asyncio Task that performs the long-running action of the current ``play_state``, if any."""
        return self._action[1]

    def _perform_action(self, action: Optional[Awaitable]):
        """Performs a new action, canceling the previous one if any."""
        async def run_action():
            try:
                await action
            except GameError:
                LOGGER.error("Performing action failed, quitting bot %s", self, exc_info=True)
                self.quit()
                return
            else:
                # does not occur if we are cancelled while running
                self._action = ("acted", None)

        if self.action_task:
            self.action_task.cancel()
        if action:
            task = create_task_log_errors(run_action())
            self._action = ("acting", task)
        else:
            self._action = ("not_acted", None)

    def quit(self):
        self.finished = True
        self._perform_action(None)
        create_task_log_errors(self.disconnect())

    def handle_authenticated(self):
        create_task_log_errors(self.join_or_create_game())

    def handle_disconnected(self):
        self.quit()

    def handle_update(self, update: dict):
        if self.finished:
            return
        if "game" in update and not update["game"] and self.game_state != "not_in_game":
            # removed from game by a player, our job here is done
            self.quit()
            return

        prev_game_state = self.game_state

        # get information from update and store in instance variables
        if "game" in update:
            self.game_state = update["game"]["state"]
            self.game_code = update["game"]["code"]
            if update["game"]["current_round"]:
                self.pick_count = update["game"]["current_round"]["black_card"]["pick_count"]
                self.white_cards = update["game"]["current_round"]["white_cards"]
                self.round_id = update["game"]["current_round"]["id"]
                self.card_czar_id = update["game"]["current_round"]["card_czar"]
            else:
                self.white_cards = self.pick_count = self.round_id = self.card_czar_id = None
        if "hand" in update:
            self.hand = update["hand"]
        if "players" in update:
            self.players_in_game = len(update["players"])
            self.is_host = self.players_in_game >= 1 and self.player_id == update["players"][0]["id"]
        if "options" in update:
            self.game_options = update["options"]

        # wait until all info is received before acting
        self.updates_received.update(update.keys())
        if not {"game", "players", "options"} <= self.updates_received:
            return

        # cancel remaining actions after any game state changes
        if self.game_state != prev_game_state:
            self._perform_action(None)
            if prev_game_state == "not_in_game":
                LOGGER.info("%s joined game %s", self, self.game_code)

        # make sure bots only participate in public games
        if self.game_join_complete and not self.game_options["public"]:
            LOGGER.info("%s quitting game %s as it is not longer public", self, self.game_code)
            self.quit()
        # quit if the game ended
        elif self.game_state == "game_ended" and prev_game_state != "not_in_game":
            LOGGER.info("%s quitting finished game %s", self, self.game_code)
            self.quit()
        # start the game if necessary
        elif self.game_state == "not_started" and self.action_state == "not_acted" and self.is_host:
            target_players = min(_target_game_size(self.game_code), self.game_options["player_limit"])
            if self.players_in_game >= target_players:
                LOGGER.info("%s starting game %s with %s players (target %s)", self, self.game_code,
                            self.players_in_game, target_players)
                self._perform_action(self.start_game())
            else:
                LOGGER.debug("%s is the host of game %s, waiting for players %s/%s", self, self.game_code,
                             self.players_in_game, target_players)
        # schedule playing as player or card czar if necessary
        elif self.game_state == "playing" and self.action_state == "not_acted" and self.player_id != self.card_czar_id:
            self._perform_action(self.play_white())
        elif self.game_state == "judging" and self.action_state == "not_acted" and self.player_id == self.card_czar_id:
            self._perform_action(self.play_czar())

    def handle_event(self, event: dict) -> None:
        if self.finished:
            return
        # allow bots to be force-quit from games via chat
        if event.get("type") == "chat_message" and event["text"] in ("bot all quit", f"bot {self.username} quit"):
            self.quit()

    async def join_or_create_game(self):
        while True:
            # sleep randomly to avoid race conditions
            await self.play_sleep()
            # find and join a game if possible
            games = await self.connection.call(ApiAction.game_list)
            for game in games["games"]:
                target_size = min(_target_game_size(game["code"]), game["player_limit"])
                if game["players"] < target_size and not game["passworded"]:
                    LOGGER.info("%s joining game %s", self, game["code"])
                    await self.connection.call(ApiAction.join_game, {
                        "code": game["code"],
                    })
                    self.game_join_complete = True
                    return
            # create a game if none were found
            if config.debug.bots.create_games:
                LOGGER.info("%s creating new game", self)
                await self.connection.call(ApiAction.create_game)
                await self.connection.call(ApiAction.game_options, {
                    "public": True,
                    **config.debug.bots.game_options,
                })
                self.game_join_complete = True
                return

    async def start_game(self):
        pack_ids = [pack["id"] for pack in self.connection.server_config["card_packs"]]
        # set card packs right before starting game in case the game was inherited from a stupid human
        await self.connection.call(ApiAction.game_options, {
            "card_packs": pack_ids,
            **config.debug.bots.game_options,
        })
        await self.play_sleep()
        await self.connection.call(ApiAction.start_game)

    async def play_white(self):
        await self.play_sleep()
        cards = sample(self.hand, self.pick_count)
        LOGGER.debug("%s playing cards in game %s: %r", self, self.game_code,
                     ["<blank card>" if card["blank"] else card["text"] for card in cards])
        await self.connection.call(ApiAction.play_white, {
            "round": self.round_id,
            "cards": [{
                "id": card["id"],
                "text": "This blank card was played by a bot." if card["blank"] else None,
            } for card in cards]
        })

    async def play_czar(self):
        await self.play_sleep()
        winner = choice(self.white_cards)
        LOGGER.debug("%s choosing winner in game %s: %r", self, self.game_code, [card["text"] for card in winner])
        winner_id = winner[0]["id"]
        await self.connection.call(ApiAction.choose_winner, {
            "round": self.round_id,
            "winner": winner_id,
        })


async def run_bots(server: GameServer, stop_condition: Future):
    running_bots: List[RandomPlayBot] = []

    def start_bot():
        new_bot = RandomPlayBot(lambda: DirectBotConnection(server, new_bot))
        LOGGER.info("Starting %s", new_bot)
        running_bots.append(new_bot)
        create_task_log_errors(new_bot.connect())

    while not stop_condition.done():
        await sleep(1)
        # find and remove bots that have quit
        for bot in running_bots:
            if bot.finished:
                running_bots.remove(bot)
        # start a new bot each second if more are needed
        if len(running_bots) < config.debug.bots.count:
            start_bot()
