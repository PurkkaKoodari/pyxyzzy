from __future__ import annotations

from asyncio import get_event_loop, Handle
from base64 import b64encode
from dataclasses import dataclass, field
from enum import Enum, auto
from hashlib import md5
from os import urandom
from random import shuffle, choice
from typing import (TypeVar, Tuple, Optional, FrozenSet, Generic, List, Set, Sequence, Dict, Iterable, TYPE_CHECKING,
                    NewType)
from uuid import UUID, uuid4

from pyxyzzy.config import config
from pyxyzzy.database import DbCardPack, DbWhiteCard, DbBlackCard, db_connection
from pyxyzzy.exceptions import InvalidGameState
from pyxyzzy.utils import CallbackTimer, single, generate_code, create_task_log_errors
from pyxyzzy.utils.config import ConfigObject
from pyxyzzy.utils.searchablelist import SearchableList, IndexType

if TYPE_CHECKING:
    from pyxyzzy.server import GameConnection

CardT = TypeVar("CardT")

UserID = NewType("UserID", UUID)
WhiteCardID = NewType("WhiteCardID", UUID)
CardPackID = NewType("CardPackID", UUID)
RoundID = NewType("RoundID", UUID)
GameCode = NewType("GameID", str)


class LeaveReason(Enum):
    leave = auto()
    host_kick = auto()
    disconnect = auto()
    idle = auto()


class GameState(Enum):
    not_started = auto()
    playing = auto()
    judging = auto()
    round_ended = auto()
    game_ended = auto()


class UpdateType(Enum):
    game = auto()
    players = auto()
    hand = auto()
    options = auto()


@dataclass(frozen=True)
class BlackCard:
    text: str
    pick_count: int
    draw_count: int
    pack_name: Optional[str] = None

    def to_json(self) -> dict:
        return {
            "text": self.text,
            "pick_count": self.pick_count,
            "draw_count": self.draw_count,
            "pack_name": self.pack_name,
        }


@dataclass(frozen=True)
class WhiteCard:
    """A white card contains an answer to a black card.

    ``slot_id`` does not uniquely identify a white card; instead, it uniquely identifies a "physical card". This makes
    a difference for blank cards, where the card can be written onto while keeping the same ``slot_id``. For non-blank
    cards, ``slot_id`` is unique inside a deck.
    """
    slot_id: WhiteCardID
    text: Optional[str]
    blank: bool = False
    pack_name: Optional[str] = None

    @classmethod
    def new_blank(cls) -> WhiteCard:
        return cls(WhiteCardID(uuid4()), None, True)

    def write_blank(self, text: str) -> WhiteCard:
        if not self.blank:
            raise InvalidGameState("invalid_white_cards", "card is not a blank")
        return WhiteCard(self.slot_id, text, True)

    def to_json(self) -> dict:
        return {
            "id": str(self.slot_id),
            "text": self.text,
            "blank": self.blank,
            "pack_name": self.pack_name,
        }


@dataclass(frozen=True)
class CardPack:
    id: CardPackID
    name: str
    black_cards: FrozenSet[BlackCard]
    white_cards: FrozenSet[WhiteCard]

    def to_json(self):
        return {
            "id": str(self.id),
            "name": self.name,
            "black_cards": len(self.black_cards),
            "white_cards": len(self.white_cards),
        }


def _card_packs_json(packs: Sequence[CardPack]):
    return [str(pack.id) for pack in packs]


class GameOptions(ConfigObject):
    game_title: str = config.game.title.make_options_field()
    public: bool = config.game.public.make_options_field()
    think_time: int = config.game.think_time.make_options_field()
    round_end_time: int = config.game.round_end_time.make_options_field()
    idle_rounds: int = config.game.idle_rounds.make_options_field()
    blank_cards: int = config.game.blank_cards.count.make_options_field()
    player_limit: int = config.game.player_limit.make_options_field()
    point_limit: int = config.game.point_limit.make_options_field()
    password: str = config.game.password.make_options_field()
    card_packs: Tuple[CardPack] = field(default=(), metadata={"to_json": _card_packs_json})

    updateable_ingame = ["game_title", "public", "password", "player_limit"]


class User:
    id: UserID
    token: str
    name: str
    server: GameServer
    game: Optional[Game] = None
    player: Optional[Player] = None

    connection: Optional[GameConnection]
    # TODO: do we need a different timer for kick and user delete? probably not
    _disconnect_kick_timer: CallbackTimer
    _disconnect_remove_timer: CallbackTimer

    def __init__(self, name: str, server: GameServer, connection: GameConnection):
        self.id = UserID(uuid4())
        self.token = b64encode(urandom(24)).decode("ascii")
        self.name = name
        self.server = server
        self.connection = connection
        self._disconnect_kick_timer = CallbackTimer()
        self._disconnect_remove_timer = CallbackTimer()

    def __str__(self):
        return f"{self.name} [{self.id}]"

    def __repr__(self):
        return f"<User name={self.name} id={self.id}>"

    def disconnected(self, connection: GameConnection):
        """Removes the user's connection and starts the timers to kick the user if they don't reconnect on time.

        Called by the connection when it detects a disconnection.
        """
        if connection is not self.connection:
            return
        self.connection = None
        self._disconnect_remove_timer.start(config.users.disconnect_forget_time, self._remove_if_disconnected)
        if self.game:
            self._disconnect_kick_timer.start(config.users.disconnect_kick_time, self._kick_if_disconnected)

    def reconnected(self, connection: GameConnection):
        """Reattaches the user to a connection and cancels the disconnection kick timers."""
        if self.connection:
            create_task_log_errors(self.connection.replaced())
        self.connection = connection
        self._disconnect_kick_timer.cancel()
        self._disconnect_remove_timer.cancel()

    def added_to_game(self, game: Game, player: Player):
        assert not self.game, "user already in game"
        if not self.connection:
            raise InvalidGameState("user_not_connected", "user not connected")
        self.game = game
        self.player = player

    def removed_from_game(self):
        assert self.game, "user not in game"
        self.game = None
        self.player = None
        self._disconnect_kick_timer.cancel()

    def _kick_if_disconnected(self):
        assert self.game and not self.connection
        self.game.remove_player(self.player, LeaveReason.disconnect)

    def _remove_if_disconnected(self):
        assert not self.connection
        self.server.remove_user(self, LeaveReason.disconnect)

    def send_message(self, message: dict):
        if self.connection:
            create_task_log_errors(self.connection.send_json_to_client(message))


class Deck(Generic[CardT]):
    _deck: List[CardT]
    _discarded: List[CardT]

    def __init__(self):
        self._deck = []
        self._discarded = []

    @classmethod
    def build_white(cls, packs: Sequence[CardPack], blanks: int) -> Deck[WhiteCard]:
        """Build a deck of white cards from the given card packs."""
        deck = cls()
        seen = set()
        for pack in packs:
            for card in pack.white_cards:
                if card.text not in seen:
                    deck._discarded.append(card)
                    seen.add(card.text)
        for _ in range(blanks):
            deck._discarded.append(WhiteCard.new_blank())
        return deck

    @classmethod
    def build_black(cls, packs: Sequence[CardPack]) -> Deck[BlackCard]:
        """Build a deck of black cards from the given card packs."""
        deck = cls()
        seen = set()
        for pack in packs:
            for card in pack.black_cards:
                if card.text not in seen:
                    deck._discarded.append(card)
                    seen.add(card.text)
        return deck

    def draw(self, *, discard=False) -> CardT:
        """Draw a card and optionally adds it to the discard pile.

        If the deck is empty, shuffles the discard pile into it first.
        """
        if not self._deck:
            self.reshuffle()
            if not self._deck:
                raise LookupError("no cards in deck")
        card = self._deck.pop()
        if discard:
            self.discard(card)
        return card

    def discard(self, card: CardT) -> None:
        """Add the given card to the discards pile.

        If given a blank white card, it is replaced with a new unused one.
        """
        if isinstance(card, WhiteCard) and card.blank:
            self._discarded.append(WhiteCard.new_blank())
        else:
            self._discarded.append(card)

    def discard_all(self, cards: Iterable[CardT]) -> None:
        """Add all of the given cards to the discard pile."""
        for card in cards:
            self.discard(card)

    def total_cards(self) -> int:
        """Return the total number of cards in the deck and discard pile."""
        return len(self._discarded) + len(self._deck)

    def reshuffle(self):
        """Shuffle the discard pile back into the deck."""
        self._deck.extend(self._discarded)
        self._discarded.clear()
        shuffle(self._deck)


@dataclass
class Round:
    card_czar: Player
    black_card: BlackCard
    white_cards: Dict[UserID, Sequence[WhiteCard]] = field(default_factory=dict)
    winner: Optional[Player] = None
    id: RoundID = field(default_factory=lambda: RoundID(uuid4()))
    order_key: bytes = field(default_factory=lambda: urandom(16), init=False)

    def needs_to_play(self, player: Player) -> bool:
        """Check whether ``player`` still needs to play white cards for this round to proceed.

        Returns ``False`` if ``player`` is the Card Czar, if they already played white cards this round or if they
        just joined the game and have no white cards in their hand.
        """
        return player != self.card_czar and bool(player.hand) and player.id not in self.white_cards

    def randomize_white_cards(self) -> List[Sequence[WhiteCard]]:
        """Return the values of ``white_cards`` in a random but consistent order dependent on ``order_key``."""
        # randomize the display order by using md5 as a pseudo-random function
        display_order = sorted(self.white_cards, key=lambda player_id: md5(self.order_key + player_id.bytes).digest())
        return [self.white_cards[player_id] for player_id in display_order]


@dataclass
class Player:
    user: User
    hand: List[WhiteCard] = field(default_factory=list, init=False)
    score: int = field(default=0, init=False)
    idle_rounds: int = field(default=0, init=False)

    pending_updates: Set[UpdateType] = field(default_factory=set, init=False, repr=False)
    pending_events: List[dict] = field(default_factory=list, init=False, repr=False)

    @property
    def id(self):
        return self.user.id

    def __eq__(self, other):
        return isinstance(other, Player) and self.user == other.user

    def play_card(self, card: WhiteCard):
        for hand_card in self.hand:
            if hand_card.slot_id == card.slot_id:
                self.hand.remove(hand_card)
                return
        raise InvalidGameState("card_not_in_hand", "you do not have the card")

    def to_event_json(self):
        return {
            "id": str(self.user.id),
            "name": self.user.name,
        }


class Game:
    code: GameCode
    server: GameServer
    options: GameOptions

    rounds: List[Round]
    players: SearchableList[Player]
    state: GameState = GameState.not_started

    black_deck: Deck[BlackCard]
    white_deck: Deck[WhiteCard]

    _round_timer: CallbackTimer
    _update_handle: Optional[Handle] = None

    def __init__(self, server: GameServer):
        self.code = server.generate_game_code()
        self.server = server
        self.options = GameOptions()
        self.rounds = []
        self.players = SearchableList(id=True)
        self._round_timer = CallbackTimer()
        self._build_decks()

    def _build_decks(self):
        self.black_deck = Deck.build_black(self.options.card_packs)
        self.white_deck = Deck.build_white(self.options.card_packs, self.options.blank_cards)

    @property
    def game_running(self) -> bool:
        return self.state not in (GameState.not_started, GameState.game_ended)

    @property
    def current_round(self) -> Optional[Round]:
        """Get the current round, or ``None`` if the game is not ongoing."""
        return self.rounds[-1] if self.game_running else None

    @property
    def card_czar(self) -> Optional[Player]:
        """Get the current round's Card Czar, or ``None`` if the game is not ongoing."""
        return self.current_round.card_czar if self.game_running else None

    @property
    def host(self) -> Player:
        """Get the player that has been in the game longest."""
        return self.players[0]

    def update_options(self, new_options: GameOptions):
        self.options = new_options
        self.send_updates(UpdateType.options)

    def add_player(self, user: User):
        if user.game is not None:
            raise InvalidGameState("user_in_game", "user already in game")
        if len(self.players) >= self.options.player_limit:
            raise InvalidGameState("game_full", "the game is full")
        # check that there are enough white cards to distribute
        if self.game_running:
            total_cards_available = self.white_deck.total_cards() + sum(len(player.hand) for player in self.players)
            if total_cards_available < (config.game.hand_size + 2) * (len(self.players) + 1):
                raise InvalidGameState("too_few_white_cards", "too few white cards in the game for any more players")
        # create the user
        player = Player(user)
        self.players.append(player)
        user.added_to_game(self, player)
        # sync state to players
        self.send_event({
            "type": "player_join",
            "player": player.to_event_json(),
        })
        self.send_updates(full_resync=True, to=player)
        self.send_updates(UpdateType.players)

    def remove_player(self, player: Player, reason: LeaveReason):
        if player not in self.players:
            raise InvalidGameState("user_not_in_game", "user not in game")
        self.send_event({
            "type": "player_leave",
            "player": player.to_event_json(),
            "reason": reason.name,
        })
        # notify the user object while game state is still valid
        player.user.removed_from_game()
        # remove the player now so they won't get further messages
        self.players.remove(player)
        # send updates to the player now to ensure they get notified
        self._send_pending_updates(to=player)
        # nuke the game if no players remain
        if len(self.players) == 0:
            self.server.remove_game(self)
            return
        # end the game if only 2 players remain
        if len(self.players) <= 2 and self.game_running:
            self.send_event({
                "type": "too_few_players"
            })
            self.stop_game()
            return
        # cancel the round if the card czar leaves
        if player == self.card_czar:
            self.send_event({
                "type": "card_czar_leave"
            })
            self._cancel_round()
        if player == self.host:
            self.send_event({
                "type": "host_leave",
                "new_host": self.players[1].to_event_json(),
            })
        # discard the player's hand
        self.white_deck.discard_all(player.hand)
        # discard the player's played cards if round not decided yet
        if self.state in (GameState.playing, GameState.judging) and player.id in self.current_round.white_cards:
            played_cards = self.current_round.white_cards.pop(player.id)
            self.white_deck.discard_all(played_cards)
            # make sure to sync the played cards if necessary
            self.send_updates(UpdateType.game)
        # check if all remaining players have played
        if self.state == GameState.playing:
            self._check_all_played()
        # sync state to players
        self.send_updates(UpdateType.players)

    def _set_state(self, state: GameState):
        """Sets the game state, starts the appropriate timer and sends state updates."""
        self.state = state
        if state in (GameState.not_started, GameState.game_ended):
            self._round_timer.cancel()
        elif state == GameState.playing:
            self._round_timer.start(self.options.think_time, self._play_idle_timer)
        elif state == GameState.judging:
            self._round_timer.start(self.options.think_time, self._judge_idle_timer)
        elif state == GameState.round_ended:
            self._round_timer.start(self.options.round_end_time, self._round_end_timer)
        else:
            raise ValueError("invalid state")
        self.send_updates(UpdateType.game)

    def start_game(self):
        """Start the game, resetting it if it has ended."""
        # reset the game if one has already been played
        if self.state == GameState.game_ended:
            self.stop_game()
        if self.state != GameState.not_started:
            raise InvalidGameState("game_already_started", "game is already ongoing")
        # ensure that there are enough players
        if len(self.players) < 3:
            raise InvalidGameState("too_few_players", "too few players")
        # prepare the deck and ensure that there are enough cards
        # TODO make these errors another type instead of InvalidGameState?
        self._build_decks()
        if self.black_deck.total_cards() == 0:
            raise InvalidGameState("too_few_black_cards", "no black cards in selected packs")
        if self.white_deck.total_cards() < (config.game.hand_size + 2) * len(self.players):
            raise InvalidGameState("too_few_white_cards", "too few white cards in selected packs for this many players")
        # start the game
        self._start_next_round()

    def stop_game(self):
        """Stop and reset the game."""
        # TODO data needs to be preserved here if we want to persist game results
        self._set_state(GameState.not_started)
        for player in self.players:
            player.hand.clear()
            player.score = 0
            player.idle_rounds = 0
        self.rounds.clear()
        # rebuild decks to minimize any card desyncs
        self._build_decks()
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.hand, UpdateType.players)

    def _start_next_round(self):
        assert self.state in (GameState.not_started, GameState.round_ended)
        # find a card czar
        for round_ in reversed(self.rounds):
            if round_.card_czar in self.players:
                position = self.players.index(round_.card_czar) + 1
                card_czar = self.players[position % len(self.players)]
                break
        else:
            card_czar = choice(self.players)
        # draw a black card
        black_card = self.black_deck.draw(discard=True)
        # start the round
        round_ = Round(card_czar, black_card)
        self.rounds.append(round_)
        # draw cards to hands
        for player in self.players:
            # the card czar only draws cards up to hand_size
            target_cards = config.game.hand_size
            # other players might draw extras if indicated on the card
            if player != card_czar:
                target_cards += black_card.draw_count
            # actually draw the cards
            while len(player.hand) < target_cards:
                player.hand.append(self.white_deck.draw())
        # start idle timer
        self._set_state(GameState.playing)
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.hand, UpdateType.players)

    def _play_idle_timer(self):
        assert self.state == GameState.playing
        to_kick = []
        for player in self.players:
            # ignore players that play nice
            if not self.current_round.needs_to_play(player):
                continue
            # kick the lousy idlers
            player.idle_rounds += 1
            if player.idle_rounds >= self.options.idle_rounds:
                to_kick.append(player)
        # kick the idle players
        for player in to_kick:
            self.remove_player(player, LeaveReason.idle)
        # cancel the round if only 0 or 1 white cards were played
        if len(self.current_round.white_cards) < 2:
            self.send_event({
                "type": "too_few_cards_played"
            })
            self._cancel_round()
        else:
            self._set_state(GameState.judging)

    def play_white_cards(self, round_id: RoundID, player: Player, cards: Sequence[Tuple[WhiteCardID, Optional[str]]]):
        if self.state != GameState.playing:
            raise InvalidGameState("invalid_round_state", "white cards are not being played for the round")
        if round_id != self.current_round.id:
            raise InvalidGameState("wrong_round", "the round is not being played")
        if not self.current_round.needs_to_play(player):
            raise InvalidGameState("already_played", "you already played white cards for the round")
        # validate the cards
        if len(set(slot_id for slot_id, _ in cards)) != len(cards):
            raise InvalidGameState("invalid_white_cards", "duplicate cards chosen")
        if len(cards) != self.current_round.black_card.pick_count:
            raise InvalidGameState("invalid_white_cards", "wrong number of cards chosen")
        # find the cards in the player's hand
        cards_to_play = []
        for slot_id, text in cards:
            try:
                card = single(card for card in player.hand if card.slot_id == slot_id)
            except ValueError:
                raise InvalidGameState("card_not_in_hand", "you do not have the chosen cards")
            if text is not None:
                card = card.write_blank(text)
            cards_to_play.append(card)
        # play the cards from the hand
        for card in cards_to_play:
            player.play_card(card)
        self.current_round.white_cards[player.id] = cards_to_play
        player.idle_rounds = 0
        # start judging if necessary
        self._check_all_played()
        # sync state to players
        self.send_updates(UpdateType.players)
        self.send_updates(UpdateType.hand, UpdateType.game, to=player)

    def _check_all_played(self):
        if self.state != GameState.playing:
            return
        if not any(self.current_round.needs_to_play(player) for player in self.players):
            self._set_state(GameState.judging)

    def _judge_idle_timer(self):
        assert self.state == GameState.judging
        # kick them if they idle too much
        self.card_czar.idle_rounds += 1
        if self.card_czar.idle_rounds >= self.options.idle_rounds:
            # this will also cancel the round
            self.remove_player(self.card_czar, LeaveReason.idle)
        else:
            # card czar idle, cancel round
            self._cancel_round()

    def choose_winner(self, round_id: RoundID, winning_card: WhiteCardID):
        if self.state != GameState.judging:
            raise InvalidGameState("invalid_round_state", "the winner is not being chosen for the round")
        if round_id != self.current_round.id:
            raise InvalidGameState("wrong_round", "the round is not being played")
        # figure out the winner from the winning card
        try:
            winner_id = single(player for player, cards in self.current_round.white_cards.items()
                               if cards[0].slot_id == winning_card)
        except ValueError:
            raise InvalidGameState("invalid_winner", "no such card played")
        winner = self.players.find_by("id", winner_id)
        self.card_czar.idle_rounds = 0
        # count the score and start the next round
        self.current_round.winner = winner
        winner.score += 1
        if winner.score == self.options.point_limit:
            self._set_state(GameState.game_ended)
        else:
            self._set_state(GameState.round_ended)
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.players)

    def _round_end_timer(self):
        assert self.state == GameState.round_ended
        # discard all played white cards
        for cards in self.current_round.white_cards.values():
            self.white_deck.discard_all(cards)
        self._start_next_round()

    def _cancel_round(self):
        assert self.state in (GameState.playing, GameState.judging)
        # return white cards to hands
        for player_id, cards in self.current_round.white_cards.items():
            self.players.find_by("id", player_id).hand.extend(cards)
        # start the next round
        self._set_state(GameState.round_ended)
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.hand)

    def _resolve_send_to(self, to: Optional[Player]):
        return self.players if to is None else [to]

    def send_updates(self, *kinds: UpdateType, to: Optional[Player] = None, full_resync: bool = False):
        if full_resync:
            kinds = UpdateType.__members__.values()
        for player in self._resolve_send_to(to):
            player.pending_updates.update(kinds)
        self._send_pending_updates_later()

    def send_event(self, event: dict, to: Optional[Player] = None):
        assert "type" in event
        for player in self._resolve_send_to(to):
            player.pending_events.append(event)
        self._send_pending_updates_later()

    def _send_pending_updates_later(self):
        if self._update_handle is None:
            self._update_handle = get_event_loop().call_soon(self._send_pending_updates)

    def _send_pending_updates(self, to: Optional[Player] = None):
        if to is None:
            self._update_handle = None
        for player in self._resolve_send_to(to):
            to_send = {}
            # if the player was just removed, just tell them that and move on
            if player not in self.players:
                to_send["game"] = None
            else:
                # otherwise, send them the updates that are pending
                if UpdateType.hand in player.pending_updates:
                    to_send["hand"] = [card.to_json() for card in player.hand]
                if UpdateType.game in player.pending_updates:
                    white_cards = None
                    if self.state in (GameState.judging, GameState.round_ended):
                        played_cards = self.current_round.randomize_white_cards()
                        white_cards = [[card.to_json() for card in play_set] for play_set in played_cards]
                    elif self.state == GameState.playing and player.id in self.current_round.white_cards:
                        white_cards = [[card.to_json() for card in self.current_round.white_cards[player.id]]]
                    to_send["game"] = {
                        "code": self.code,
                        "state": self.state.name,
                        "current_round": {
                            "id": str(self.current_round.id),
                            "black_card": self.current_round.black_card.to_json(),
                            "white_cards": white_cards,
                            "card_czar": str(self.current_round.card_czar.id),
                            "winner": {
                                "player": str(self.current_round.winner.id),
                                "cards": str(self.current_round.white_cards[self.current_round.winner.id][0].slot_id),
                            } if self.current_round.winner else None
                        } if self.current_round else None
                    }
                if UpdateType.players in player.pending_updates:
                    to_send["players"] = [{
                        "id": str(player.id),
                        "name": player.user.name,
                        "score": player.score,
                        "playing": self.state == GameState.playing and self.current_round.needs_to_play(player),
                    } for player in self.players]
                if UpdateType.options in player.pending_updates:
                    to_send["options"] = self.options.to_json()
            # always send pending events
            if player.pending_events:
                to_send["events"] = player.pending_events[:]
            player.pending_updates.clear()
            player.pending_events.clear()
            if to_send:
                player.user.send_message(to_send)

    def game_list_json(self):
        title = self.options.game_title.strip()
        if not title:
            title = config.game.title.default.replace("{USER}", self.host.user.name)
        return {
            "code": str(self.code),
            "title": title,
            "players": len(self.players),
            "player_limit": self.options.player_limit,
            "passworded": bool(self.options.password)
        }


class GameServer:
    games: SearchableList[Game]
    users: SearchableList[User]
    card_packs: SearchableList[CardPack]

    def __init__(self):
        self.games = SearchableList(code=IndexType.NOT_NONE)
        self.users = SearchableList(id=IndexType.NOT_NONE, name=lambda user: user.name.lower())
        self.card_packs = SearchableList(id=IndexType.NOT_NONE)

    def load_local_packs(self):
        db_pack: DbCardPack
        db_white: DbWhiteCard
        db_black: DbBlackCard
        with db_connection.connection_context():
            for db_pack in DbCardPack.select():
                white_cards = []
                for db_white in db_pack.white_cards:
                    white_cards.append(WhiteCard(slot_id=db_white.uuid, text=db_white.text, pack_name=db_pack.name))
                black_cards = []
                for db_black in db_pack.black_cards:
                    black_cards.append(BlackCard(text=db_black.text, draw_count=db_black.draw_count,
                                                 pick_count=db_black.pick_count, pack_name=db_pack.name))
                pack = CardPack(id=db_pack.uuid, name=db_pack.name, white_cards=frozenset(white_cards),
                                black_cards=frozenset(black_cards))
                self.card_packs.append(pack)

    def config_json(self):
        return {
            **config.to_json(),
            "card_packs": [pack.to_json() for pack in self.card_packs]
        }

    def generate_game_code(self) -> GameCode:
        while True:
            attempt = GameCode(generate_code(config.game.code.characters, config.game.code.length))
            if self.games.exists("code", attempt):
                continue
            return attempt

    def add_user(self, user: User):
        self.users.append(user)

    def remove_user(self, user: User, reason: LeaveReason):
        if user.game:
            user.game.remove_player(user.player, reason)
        self.users.remove(user)

    def add_game(self, game: Game):
        self.games.append(game)

    def remove_game(self, game: Game):
        self.games.remove(game)
