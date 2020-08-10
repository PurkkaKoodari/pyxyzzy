"""Contains the structure of ``config.toml`` represented as classes.

This file defines absolute limits for some configuration values; limits in this file are only for cases where exceeding
them would make no sense at all (example: 0 seconds of think time would make games spinlock). ``config.toml`` can then
set its own stricter limits for what is considered reasonable for the players.
"""

from __future__ import annotations

import re
from dataclasses import field
from random import normalvariate
from typing import Sequence, Optional

import toml

from pyxyzzy.utils import generate_code
from pyxyzzy.utils.config import ConfigError, ParseableConfigObject, conf_field

DEFAULT_CONFIG_FILE = "config.toml"
MAX_INCLUDE_DEPTH = 16


def _validate_blacklist_syntax(blacklist: Sequence[str]):
    """Checks if all items in the blacklist are syntactically valid regexes."""
    for i, pattern in enumerate(blacklist):
        try:
            re.compile(pattern, re.IGNORECASE)
        except re.error:
            raise ConfigError(None, f"%s item {i + 1} is not a valid regex")


def _validate_against_blacklist(string: str, blacklist: Sequence[str]):
    """Validates a string against a regex blacklist."""
    return not any(re.search(pattern, string, re.IGNORECASE) for pattern in blacklist)


class IntLimits(ParseableConfigObject):
    min: int
    max: int

    def validate_self(self):
        super().validate_self()
        if self.max < self.min:
            raise ConfigError("max", "%s can't be less than min")

    def validate_as_field(self, min=None, max=None, **kwargs):
        super().validate_as_field(min=min, max=max, **kwargs)
        if min is not None and self.min < min:
            raise ConfigError("min", f"%s must be at least {min}")
        if max is not None and self.max > max:
            raise ConfigError("max", f"%s must be at most {max}")

    def as_range(self):
        return range(self.min, self.max + 1)


class IntOptions(IntLimits):
    default: int

    def validate_self(self):
        super().validate_self()
        if not self.min <= self.default <= self.max:
            raise ConfigError("default", "%s must be between min and max")

    def make_options_field(self):
        return field(default=self.default, metadata={"min": self.min, "max": self.max})


class NormalDistributionOptions(ParseableConfigObject):
    mean: float
    stddev: float

    def sample(self):
        return normalvariate(self.mean, self.stddev)


class GlobalConfig(ParseableConfigObject):
    debug: DebugConfig = conf_field(to_json=False)
    server: ServerConfig = conf_field(to_json=False)
    database: DatabaseConfig = conf_field(to_json=False)
    game: GameConfig
    users: UserConfig
    chat: ChatConfig


class DebugConfig(ParseableConfigObject):
    enabled: bool
    bots: BotConfig


class BotConfig(ParseableConfigObject):
    count: int = conf_field(min=0, max=1000)
    game_size: int = conf_field(min=3)
    create_games: bool
    play_speed: NormalDistributionOptions
    game_options: dict


class ServerConfig(ParseableConfigObject):
    host: str
    port: int = conf_field(min=1, max=65535)


class DatabaseConfig(ParseableConfigObject):
    file: str


class GameConfig(ParseableConfigObject):
    title: GameTitleConfig
    password: GamePasswordConfig
    public: GamePublicityConfig

    think_time: IntOptions = conf_field(min=1)
    round_end_time: IntOptions = conf_field(min=1)
    idle_rounds: IntOptions = conf_field(min=1)

    blank_cards: BlankCardConfig
    player_limit: IntOptions = conf_field(min=3)
    point_limit: IntOptions = conf_field(min=1)

    hand_size: int = conf_field(min=2)

    code: GameCodeConfig


class GameTitleConfig(ParseableConfigObject):
    max_length: int = conf_field(min=0)
    default: str
    blacklist: Sequence[str] = conf_field(to_json=False, validate=_validate_blacklist_syntax)

    def make_options_field(self):
        return field(default="", metadata={"max_length": self.max_length, "validate": self._validate_title})

    def _validate_title(self, title: str):
        # no need to validate length as the field has max_length
        # TODO: check for bad unicode characters
        if not _validate_against_blacklist(title, self.blacklist):
            raise ConfigError(None, "%s: blacklisted words used")


class GamePasswordConfig(ParseableConfigObject):
    length: IntOptions = conf_field(min=0)
    characters: str = conf_field(min_length=1)

    def make_options_field(self):
        return field(default_factory=self._generate_default_password,
                     metadata={"min_length": self.length.min, "max_length": self.length.max})

    def _generate_default_password(self):
        return generate_code(self.characters, self.length.default)


class GamePublicityConfig(ParseableConfigObject):
    default: bool
    allowed: bool
    required: bool

    def validate_self(self):
        super().validate_self()
        if not self.allowed and self.required:
            raise ConfigError("required", "%s can't be true if allowed is false")
        if not self.allowed and self.default:
            raise ConfigError("default", "%s can't be true if allowed is false")
        if self.required and not self.default:
            raise ConfigError("default", "%s can't be false if required is true")

    def make_options_field(self):
        return field(default=self.default, metadata={"validate": self._validate_public})

    def _validate_public(self, public):
        if public and not self.allowed:
            raise ConfigError(None, "%s: public games are disabled")
        if not public and self.required:
            raise ConfigError(None, "%s: private games are disabled")


class BlankCardConfig(ParseableConfigObject):
    count: IntOptions = conf_field(min=0)
    max_length: int = conf_field(min=1)
    blacklist: Sequence[str] = conf_field(to_json=False, validate=_validate_blacklist_syntax)

    def is_valid_text(self, text: str):
        text = text.strip()
        if not 1 <= len(text) <= self.max_length:
            return False
        # TODO: check for bad unicode characters
        return _validate_against_blacklist(text, self.blacklist)


class GameCodeConfig(ParseableConfigObject):
    length: int = conf_field(min=1)
    characters: str = conf_field(min_length=2)


class UserConfig(ParseableConfigObject):
    username: UsernameConfig
    disconnect_kick_time: int = conf_field(min=1, to_json=False)
    disconnect_forget_time: int = conf_field(min=1, to_json=False)


class UsernameConfig(ParseableConfigObject):
    length: IntLimits = conf_field(min=1)
    characters: str = conf_field(min_length=1)
    blacklist: Sequence[str] = conf_field(to_json=False, validate=_validate_blacklist_syntax)

    def is_valid_name(self, username):
        if len(username) not in self.length.as_range():
            return False
        # TODO: check for bad unicode characters
        bad_regex = r"^ | {2}| $|[^" + self.characters + r"]"
        if re.search(bad_regex, username):
            return False
        return _validate_against_blacklist(username, self.blacklist)


class ChatConfig(ParseableConfigObject):
    max_length: int = conf_field(min=1)
    blacklist: Sequence[str] = conf_field(to_json=False, validate=_validate_blacklist_syntax)

    def is_valid_message(self, message: str):
        message = message.strip()
        if not 1 <= len(message) <= self.max_length:
            return False
        # TODO: check for bad unicode characters
        return _validate_against_blacklist(message, self.blacklist)


config: Optional[GlobalConfig] = None


def _merge_dicts(left: dict, right: dict) -> dict:
    """Recursively merge all ``dict``s in ``right`` into ``left``. ``list``s are overwritten instead of recursing."""
    if not isinstance(left, dict):
        raise ConfigError(None, f"can't merge dict in %s into {type(left).__name__} from included file")
    for key, rval in right.items():
        if isinstance(rval, dict):
            lval = left.setdefault(key, {})
            try:
                _merge_dicts(lval, rval)
            except ConfigError as ex:
                raise ex.parent_error(key) from None
        else:
            left[key] = rval
    return left


def _load_toml(file: str, depth=0) -> dict:
    """Loads raw TOML data from a file, processing ``include`` directives."""
    with open(file) as stream:
        toml_data = toml.load(stream)

    if "include" in toml_data:
        if depth >= MAX_INCLUDE_DEPTH:
            raise ConfigError("include",
                              f"%s: config files can't be included more than {MAX_INCLUDE_DEPTH} levels deep")
        included_file = toml_data.pop("include")
        included_data = _load_toml(included_file)
        toml_data = _merge_dicts(included_data, toml_data)

    return toml_data


def load(file: str = None, reload: str = False):
    """Loads the global config object from a file, or ``DEFAULT_CONFIG_FILE`` if not provided.

    May only be called once unless ``reload`` is set.
    """
    global config
    if file is None:
        file = DEFAULT_CONFIG_FILE
    if config is not None and not reload:
        raise RuntimeError("attempting to load config while it is already loaded")
    toml_data = _load_toml(file)
    config = GlobalConfig.from_dict(toml_data)
