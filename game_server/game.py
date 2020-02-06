from __future__ import annotations

from asyncio import get_event_loop, Handle
from base64 import b64encode
from dataclasses import dataclass, field, InitVar
from enum import Enum, auto
from hashlib import md5
from os import urandom
from random import shuffle, choice
from typing import (TypeVar, Tuple, Optional, FrozenSet, Generic, List, Set, Sequence, Dict, Union, Iterable,
                    get_origin)
from uuid import UUID, uuid4

from channels.generic.websocket import AsyncJsonWebsocketConsumer

from game_server.config import (MIN_THINK_TIME, MAX_THINK_TIME, MAX_BLANK_CARDS, MAX_PLAYER_LIMIT, MAX_POINT_LIMIT,
                                DISCONNECTED_KICK_TIMER, HAND_SIZE, MAX_PASSWORD_LENGTH, MIN_ROUND_END_TIME,
                                MAX_ROUND_END_TIME, MIN_IDLE_ROUNDS, MAX_IDLE_ROUNDS, DEFAULT_THINK_TIME,
                                DEFAULT_ROUND_END_TIME, DEFAULT_PASSWORD, DEFAULT_POINT_LIMIT, DEFAULT_PLAYER_LIMIT,
                                DEFAULT_BLANK_CARDS, DEFAULT_IDLE_ROUNDS, DISCONNECTED_REMOVE_TIMER)
from game_server.exceptions import InvalidGameState
from game_server.utils import SearchableList, CallbackTimer

CardT = TypeVar("CardT")


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


@dataclass
class GameOptions:
    think_time: int = field(default=DEFAULT_THINK_TIME, metadata={"min": MIN_THINK_TIME, "max": MAX_THINK_TIME})
    round_end_time: int = field(default=DEFAULT_ROUND_END_TIME,
                                metadata={"min": MIN_ROUND_END_TIME, "max": MAX_ROUND_END_TIME})
    idle_rounds: int = field(default=DEFAULT_IDLE_ROUNDS, metadata={"min": MIN_IDLE_ROUNDS, "max": MAX_IDLE_ROUNDS})
    blank_cards: int = field(default=DEFAULT_BLANK_CARDS, metadata={"min": 0, "max": MAX_BLANK_CARDS})
    player_limit: int = field(default=DEFAULT_PLAYER_LIMIT, metadata={"min": 3, "max": MAX_PLAYER_LIMIT})
    point_limit: int = field(default=DEFAULT_POINT_LIMIT, metadata={"min": 1, "max": MAX_POINT_LIMIT})
    password: str = field(default=DEFAULT_PASSWORD, metadata={"max_length": MAX_PASSWORD_LENGTH})
    card_packs: Tuple[CardPack] = ()

    def __setattr__(self, key, value):
        if key in self.__class__.__dataclass_fields__:
            field = self.__class__.__dataclass_fields__[key]

            required_type = get_origin(field.type)
            if isinstance(required_type, type) and not isinstance(value, required_type):
                raise TypeError(f"{key} must be {required_type.__name__}")

            if "min" in field.metadata and value < field.metadata["min"]:
                raise ValueError(f"{key} must be at least {field.metadata['min']}")
            if "max" in field.metadata and value > field.metadata["max"]:
                raise ValueError(f"{key} must be at most {field.metadata['max']}")

            if "minlength" in field.metadata and len(value) < field.metadata["minlength"]:
                raise ValueError(f"length of {key} must be at least {field.metadata['min']}")
            if "maxlength" in field.metadata and len(value) > field.metadata["maxlength"]:
                raise ValueError(f"length of {key} must be at most {field.metadata['maxlength']}")

        object.__setattr__(self, key, value)

    def to_json(self):
        return {
            "think_time": self.think_time,
            "round_end_time": self.round_end_time,
            "idle_rounds": self.idle_rounds,
            "blank_cards": self.blank_cards,
            "player_limit": self.player_limit,
            "password": self.password,
            "card_packs": [{
                "id": str(pack.id),
                "name": pack.name,
                "white_cards": len(pack.white_cards),
                "black_cards": len(pack.black_cards)
            } for pack in self.card_packs]
        }


@dataclass
class User:
    id: UUID = field(default_factory=uuid4, init=False)
    token: str = field(default_factory=lambda: b64encode(urandom(24)), init=False)
    name: str
    server: GameServer
    game: Optional[Game] = field(default=None, init=False, repr=False)
    player: Optional[Player] = field(default=None, init=False, repr=False)

    connection: Optional[AsyncJsonWebsocketConsumer] = field(default=None, repr=False)
    # TODO: do we need a different timer for kick and user delete? probably not
    _disconnect_kick_timer: CallbackTimer = field(default_factory=CallbackTimer, init=False, repr=False)
    _disconnect_remove_timer: CallbackTimer = field(default_factory=CallbackTimer, init=False, repr=False)

    def __hash__(self):
        return hash(self.id)

    def __eq__(self, other):
        return isinstance(other, User) and self.id == other.id

    def disconnected(self):
        self.connection = None
        self._disconnect_remove_timer.start(DISCONNECTED_REMOVE_TIMER, self._remove_if_disconnected)
        if self.game:
            self._disconnect_kick_timer.start(DISCONNECTED_KICK_TIMER, self._kick_if_disconnected)

    def reconnected(self, connection: AsyncJsonWebsocketConsumer):
        self.connection = connection
        self._disconnect_kick_timer.cancel()
        self._disconnect_remove_timer.cancel()

    def added_to_game(self, game: Game, player: Player):
        if self.game:
            raise InvalidGameState("user already in game")
        if not self.connection:
            raise InvalidGameState("user not connected")
        self.game = game
        self.player = player

    def removed_from_game(self):
        if not self.game:
            raise InvalidGameState("player not in game")
        self.game = None
        self.player = None
        self._disconnect_kick_timer.cancel()

    def _kick_if_disconnected(self):
        if self.game and not self.connection:
            self.game.remove_player(self.player, LeaveReason.disconnect)

    def _remove_if_disconnected(self):
        assert not self.connection
        self.server.remove_user(self, LeaveReason.disconnect)

    def send_message(self, message: dict):
        if self.connection:
            self.connection.queue.put_nowait(message)


@dataclass(frozen=True)
class BlackCard:
    text: str
    pick_count: int
    draw_count: int

    def to_json(self) -> dict:
        return {
            "text": self.text,
            "pick_count": self.pick_count,
            "draw_count": self.draw_count
        }


@dataclass(frozen=True)
class WhiteCard:
    """A white card contains an answer to a black card.

    ``slot_id`` does not uniquely identify a white card; instead, it uniquely identifies a "physical card". This makes
    a difference for blank cards, where the card can be written onto while keeping the same ``slot_id``. For non-blank
    cards, ``slot_id`` is unique inside a deck.
    """
    slot_id: UUID
    text: Optional[str]
    blank: bool = False

    @classmethod
    def new_blank(cls) -> WhiteCard:
        return cls(uuid4(), None, True)

    def write_blank(self, text: str) -> WhiteCard:
        if not self.blank:
            raise InvalidGameState("card is not a blank")
        return WhiteCard(self.slot_id, text, True)

    def to_json(self) -> dict:
        return {
            "id": str(self.slot_id),
            "text": self.text,
            "blank": self.blank
        }


@dataclass(frozen=True)
class CardPack:
    id: UUID
    name: str
    black_cards: FrozenSet[BlackCard, ...]
    white_cards: FrozenSet[WhiteCard, ...]


@dataclass
class Deck(Generic[CardT]):
    _deck: List[CardT] = field(default_factory=list)
    _discarded: Set[CardT] = field(default_factory=set)

    @classmethod
    def build_white(cls, packs: Sequence[CardPack], blanks: int) -> Deck[WhiteCard]:
        """Build a deck of white cards from the given card packs."""
        deck = cls()
        for pack in packs:
            deck._discarded.update(pack.white_cards)
        for _ in range(blanks):
            deck._discarded.add(WhiteCard.new_blank())
        return deck

    @classmethod
    def build_black(cls, packs: Sequence[CardPack]) -> Deck[BlackCard]:
        """Build a deck of black cards from the given card packs."""
        deck = cls()
        for pack in packs:
            deck._discarded.update(pack.black_cards)
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
            self._discarded.add(WhiteCard.new_blank())
        else:
            self._discarded.add(card)

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
    white_cards: Dict[UUID, Sequence[WhiteCard]] = field(default_factory=dict)
    winner: Optional[Player] = None
    id: UUID = field(default_factory=uuid4)
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

    pending_updates: Set[UpdateType] = field(default_factory=set, init=False)
    pending_events: List[dict] = field(default_factory=list, init=False)

    @property
    def id(self):
        return self.user.id

    def __eq__(self, other):
        return isinstance(other, Player) and self.user == other.user

    def can_play_card(self, card: WhiteCard):
        return any(hand_card.slot_id == card.slot_id for hand_card in self.hand)

    def play_card(self, card: WhiteCard):
        for hand_card in self.hand:
            if hand_card.slot_id == card.slot_id:
                self.hand.remove(hand_card)
                return
        raise InvalidGameState("player does not have the card")


@dataclass(repr=False)
class Game:
    server: GameServer
    options: GameOptions

    rounds: List[Round] = field(default_factory=list, init=False)
    players: List[Player] = field(default_factory=list, init=False)
    state: GameState = field(default=GameState.not_started, init=False)

    black_deck: Deck[BlackCard] = field(init=False)
    white_deck: Deck[WhiteCard] = field(init=False)

    _round_timer: CallbackTimer = field(default_factory=CallbackTimer, init=False)

    update_handle: Optional[Handle] = field(default=None, init=False)

    creator: InitVar[User]

    def __post_init__(self, creator: User):
        self._build_decks()
        self.add_player(creator)

    def _build_decks(self):
        self.black_deck = Deck.build_black(self.options.card_packs)
        self.white_deck = Deck.build_white(self.options.card_packs, self.options.blank_cards)

    def player_by_id(self, id_: UUID) -> Player:
        """Get the player with the given ``id``.

        :raises KeyError: if the player does not exist.
        """
        for player in self.players:
            if player.id == id_:
                return player
        raise KeyError("player not found")

    @property
    def current_round(self) -> Optional[Round]:
        """Get the current round, or ``None`` if the game is not ongoing."""
        return None if self.state in (GameState.not_started, GameState.game_ended) else self.rounds[-1]

    @property
    def card_czar(self) -> Optional[Player]:
        """Get the current round's Card Czar, or ``None`` if the game is not ongoing."""
        return None if self.current_round is None else self.current_round.card_czar

    @property
    def host(self) -> Player:
        """Get the player that has been in the game longest."""
        return self.players[0]

    def add_player(self, user: User):
        if user.game is not None:
            raise InvalidGameState("user already in game")
        # check that there are enough white cards to distribute
        total_cards_available = self.white_deck.total_cards() + sum(len(player.hand) for player in self.players)
        if total_cards_available < (HAND_SIZE + 2) * (len(self.players) + 1):
            raise InvalidGameState("too few white cards")
        # create the user
        player = Player(user)
        self.players.append(player)
        user.added_to_game(self, player)
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.players, UpdateType.hand, UpdateType.options, to=player)
        self.send_updates(UpdateType.players)

    def remove_player(self, player: Player, reason: LeaveReason):
        if player not in self.players:
            raise InvalidGameState("player not in game")
        self.send_event({
            "type": "player_leave",
            "player": player.user.id,
            "reason": reason.name
        })
        # notify the user object while game state is still valid
        player.user.removed_from_game()
        # nuke the game if no players remain
        if len(self.players) <= 1:
            self.server.remove_game(self)
            return
        # don't send any updates, just events
        player.pending_updates.clear()
        self._send_pending_updates(to=player)
        # remove the player now so they won't get further messages
        self.players.remove(player)
        # end the game if only 2 players remain
        if len(self.players) <= 3:
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
            raise InvalidGameState("game is already ongoing")
        # ensure that there are enough players and enough cards to play
        if len(self.players) < 3:
            raise InvalidGameState("too few players")
        if self.black_deck.total_cards() == 0:
            raise InvalidGameState("no black cards")
        if self.white_deck.total_cards() < (HAND_SIZE + 2) * len(self.players):
            raise InvalidGameState("too few white cards")
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
        if self.state in (GameState.playing, GameState.judging):
            raise InvalidGameState("round is already ongoing")
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
            target_cards = HAND_SIZE if player == card_czar else HAND_SIZE + black_card.draw_count
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

    def play_cards(self, player: Player, cards: Sequence[WhiteCard]):
        if self.state != GameState.playing:
            raise InvalidGameState("game is not in playing state")
        if player.id in self.current_round.white_cards:
            raise InvalidGameState("player has already played for the round")
        if len(set(card.slot_id for card in cards)) != len(cards):
            raise InvalidGameState("duplicates in cards")
        if not all(player.can_play_card(card) for card in cards):
            raise InvalidGameState("player does not have the cards")
        if len(cards) != self.current_round.black_card.pick_count:
            raise InvalidGameState("wrong number of cards chosen")
        # play the cards from the hand
        for card in cards:
            player.play_card(card)
        self.current_round.white_cards[player.id] = cards
        player.idle_rounds = 0
        # start judging if necessary
        self._check_all_played()
        # sync state to players
        self.send_updates(UpdateType.players)
        self.send_updates(UpdateType.hand, to=player)

    def _check_all_played(self):
        if self.state != GameState.playing:
            return
        if not any(self.current_round.needs_to_play(player) for player in self.players):
            self._set_state(GameState.judging)

    def _judge_idle_timer(self):
        assert self.state == GameState.judging
        # card czar idle, cancel round
        self._cancel_round()
        # kick them if they idle too much
        self.card_czar.idle_rounds += 1
        if self.card_czar.idle_rounds >= self.options.idle_rounds:
            self.remove_player(self.card_czar, LeaveReason.idle)

    def choose_winner(self, winner: Player):
        if self.state != GameState.judging:
            raise InvalidGameState("game is not in judging state")
        if not self.current_round.has_played(winner):
            raise InvalidGameState("player did not play valid white cards")
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
        self._start_next_round()

    def _cancel_round(self):
        if self.state not in (GameState.playing, GameState.judging):
            raise ValueError("game is not in playing or judging state")
        # return white cards to hands
        for player_id, cards in self.current_round.white_cards:
            self.player_by_id(player_id).hand.extend(cards)
        # start the next round
        self._set_state(GameState.round_ended)
        # sync state to players
        self.send_updates(UpdateType.game, UpdateType.hand)

    def _resolve_send_to(self, to: Optional[Player]):
        return self.players if to is None else [to]

    def send_updates(self, *kinds: UpdateType, to: Union[Player, Sequence[Player], None] = None):
        for player in self._resolve_send_to(to):
            player.pending_updates.update(kinds)
        self._send_pending_updates_later()

    def send_event(self, event: dict, to: Union[Player, Sequence[Player], None] = None):
        for player in self._resolve_send_to(to):
            player.pending_events.append(event)
        self._send_pending_updates_later()

    def _send_pending_updates_later(self):
        if self.update_handle is None:
            self.update_handle = get_event_loop().call_soon(self._send_pending_updates)

    def _send_pending_updates(self, to: Optional[Player] = None):
        self.update_handle = None
        for player in self._resolve_send_to(to):
            to_send = {}
            if UpdateType.hand in player.pending_updates:
                to_send["hand"] = [card.to_json() for card in player.hand]
            if UpdateType.game in player.pending_updates:
                white_cards = None
                if self.state == GameState.judging:
                    played_cards = self.current_round.randomize_white_cards()
                    white_cards = [[card.to_json() for card in play_set] for play_set in played_cards]
                to_send["game"] = {
                    "state": self.state.name,
                    "current_round": {
                        "id": self.current_round.id,
                        "black_card": self.current_round.black_card.to_json(),
                        "white_cards": white_cards,
                        "card_czar": self.current_round.card_czar.id,
                        "winner": self.current_round.winner.id if self.current_round.winner else None
                    } if self.current_round else None
                }
            if UpdateType.players in player.pending_updates:
                to_send["players"] = [{
                    "id": str(player.id),
                    "name": player.user.name,
                    "score": player.score,
                    "played": self.state == GameState.playing and self.rounds[-1].white_cards
                } for player in self.players]
            if UpdateType.options in player.pending_updates:
                to_send["options"] = self.options.to_json()
            if player.pending_events:
                to_send["events"] = player.pending_events
            player.pending_updates.clear()
            player.pending_events.clear()
            if to_send:
                player.user.send_message(to_send)


@dataclass
class GameServer:
    games: List[Game] = field(default_factory=list, init=False)
    users: SearchableList[User] = field(
        default_factory=lambda: SearchableList(id=True, name=lambda user: user.name.lower()),
        init=False)

    def add_user(self, user: User):
        self.users.append(user)

    def remove_user(self, user: User, reason: LeaveReason):
        if user.game:
            user.game.remove_player(user.player, reason)
        self.users.remove(user)

    def remove_game(self, game: Game):
        self.games.remove(game)
