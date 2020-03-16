"""Contains the structure of ``config.toml`` represented as classes.

This file defines absolute limits for some configuration values; limits in this file are only for cases where exceeding
them would make no sense at all (example: 0 seconds of think time would make games spinlock). ``config.toml`` can then
set its own stricter limits for what is considered reasonable for the players.
"""

from __future__ import annotations

import re
from dataclasses import field
from typing import Sequence, Optional

import toml

from pyxyzzy.utils import generate_code
from pyxyzzy.utils.config import ConfigError, ParseableConfigObject, conf_field

DEFAULT_CONFIG_FILE = "config.toml"

# TODO add validation for all blacklists


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


class GlobalConfig(ParseableConfigObject):
    server: ServerConfig = conf_field(to_json=False)
    database: DatabaseConfig = conf_field(to_json=False)
    game: GameConfig
    users: UserConfig
    chat: ChatConfig


class ServerConfig(ParseableConfigObject):
    host: str
    port: int = conf_field(min=1, max=65535)
    debug: bool
    ui_version: str


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
    blacklist: Sequence[str] = conf_field(to_json=False)

    def make_options_field(self):
        return field(default="", metadata={"max_length": self.max_length, "validate": self._validate_title})

    def _validate_title(self, _title):
        # TODO validate blacklist
        return True


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

    def validate_self(self):
        super().validate_self()
        if not self.allowed and self.default:
            raise ConfigError("default", "%s can't be true if allowed is false")

    def make_options_field(self):
        return field(default=self.default, metadata={"validate": self._validate_public})

    def _validate_public(self, public):
        if public and not self.allowed:
            raise ConfigError(None, "public games are disabled")


class BlankCardConfig(ParseableConfigObject):
    count: IntOptions = conf_field(min=0)
    max_length: int = conf_field(min=1)
    blacklist: Sequence[str] = conf_field(to_json=False)


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
    blacklist: Sequence[str] = conf_field(to_json=False)

    def is_valid_name(self, username):
        if len(username) not in self.length.as_range():
            return False
        bad_regex = r"^ | {2}| $|[^" + self.characters + r"]"
        if re.search(bad_regex, username):
            return False
        # TODO validate blacklist
        return True


class ChatConfig(ParseableConfigObject):
    max_length: int = conf_field(min=1)
    blacklist: Sequence[str] = conf_field(to_json=False)


config: Optional[GlobalConfig] = None


def load(file=None, reload=False):
    global config
    if file is None:
        file = DEFAULT_CONFIG_FILE
    if config is not None and not reload:
        raise RuntimeError("attempting to load config while it is already loaded")
    with open(file) as stream:
        toml_data = toml.load(stream)
    config = GlobalConfig.from_dict(toml_data)
