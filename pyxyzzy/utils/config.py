from collections import abc
from dataclasses import dataclass, fields, MISSING, field
from typing import Iterable, Union, Mapping, Optional, get_type_hints


def _get_optional_type(type_):
    """Check if a type is an ``Union`` permitting ``None``.

    For ``Optional``-like unions permitting only ``None`` and another type, returns the other type. For other
    ``None``-permitting unions, returns ``True``. For everything else, returns ``False``.
    """
    try:
        # get origin and args, raise AttributeError if missing
        origin = type_.__origin__
        args = tuple(type_.__args__)
        # ensure we're dealing with Optional/Union
        if origin != Union:
            return False
        # for Union[Some, None] return Some, raise ValueError if no None
        none_pos = args.index(type(None))
        if len(args) == 2:
            return args[1 - none_pos]
        # can't return a concrete type
        return True
    except (AttributeError, ValueError):
        return False


def _stringify_type(type_or_types):
    if isinstance(type_or_types, Iterable):
        options = list(type_or_types)
        if len(options) == 0:
            # should never happen, but avoid erroring here
            return "<nonexistent>"
        if len(options) == 1:
            return _stringify_type(options[0])
        return ", ".join(_stringify_type(type_) for type_ in options[:-1]) + " or " + _stringify_type(options[-1])

    if type_or_types is type(None):
        return "None"

    try:
        # attempt to handle generic aliases prettily
        origin = type_or_types.__origin__
        return f"{origin._name}[{_stringify_type(type_or_types.__args__)}]"
    except AttributeError:
        try:
            # handle regular classes
            return type_or_types.__name__
        except AttributeError:
            # fallback, should always work
            return str(type_or_types)


def _validate_field_type(name, type_, value):
    # get the origin type for generic aliases
    try:
        origin = type_.__origin__
    except AttributeError:
        origin = type_

    # handle unions specially
    if origin == Union:
        for option in type_.__args__:
            try:
                _validate_field_type(name, option, value)
                return
            except ConfigError:
                pass
        raise ConfigError(name, f"%s must be {_stringify_type(type_.__args__)}, not {type(value).__name__}")

    if not isinstance(origin, type):
        # ignore any weird generic aliases
        return
    if not isinstance(value, origin):
        raise ConfigError(name, f"%s must be {origin.__name__}, not {type(value).__name__}")

    # try to validate items for generic iterables
    try:
        args = type_.__args__
    except AttributeError:
        return
    if issubclass(origin, abc.Sequence):
        value: abc.Sequence
        (item_type, ) = args
        for index, item in enumerate(value):
            _validate_field_type(f"{name}[{index}]", item_type, item)
    elif issubclass(origin, abc.Mapping):
        value: abc.Mapping
        key_type, value_type = args
        for key, item in value.items():
            _validate_field_type(f"{name} keys", key_type, key)
            _validate_field_type(f"{name}[{key}]", value_type, item)
    elif issubclass(origin, abc.Iterable):
        value: abc.Iterable
        (item_type, ) = args
        for index, item in enumerate(value):
            _validate_field_type(f"{name} items", item_type, item)


@dataclass(frozen=True)
class ConfigError(Exception):
    """Validation of a config object failed.

    ``field`` contains the name of the field that caused the error, or ``None`` if the entire config object raising
    the error is the source.

    ``message`` contains the error message and must contain ``%s`` exactly once, marking the field name.
    """

    field: Optional[str]
    message: str

    def __post_init__(self):
        if self.message.count("%s") != 1:
            raise ValueError("message must contain %s exactly once")

    def __str__(self):
        if not self.field:
            return (self.message % "").strip()
        return self.message % self.field

    def parent_error(self, field: str):
        """Returns a copy of this exception from a parent object's perspective.

        This consists of setting the field name to ``parentfield.exceptionfield``, where ``parentfield`` is the given
        field name and ``exceptionfield`` is this exception's field name.
        """
        if not self.field:
            return ConfigError(field, self.message)
        return ConfigError(f"{field}.{self.field}", self.message)


@dataclass(frozen=True)
class ConfigObject:
    """Base class for frozen data classes that can automatically validate their fields and can be converted to JSON.

    All fields are validated upon object creation to ensure that their type matches their type annotation. Items of
    generic iterables are validated against the type argument. Unions are also supported and pass validation if any of
    the options match.

    Fields can additionally have validation options in their ``metadata`` dict. The following keys are supported:

    - ``min`` and ``max`` use ``<`` and ``>`` respectively to check the values.
    - ``min_length`` and ``max_length`` check the ``len()`` of the values.
    - ``validate`` is called with the field's value if it exists.

    To add custom validation options to a field, the field's type must implement ``validate_as_field()``. If a field's
    type implements ``validate_as_field()`` and it does not return ``NotImplemented``, the validators in the above list
    are skipped.

    Custom validation checks can also be added by overriding ``validate_self()``. Make sure to call the superclass
    method. The difference between ``validate_self()`` and ``validate_as_field()`` is that the former is called for all
    instances of the class, while the latter is only called if the object is in another config object's field; only the
    latter receives the validation options defined on the parent object's field.

    Automatically calls ``dataclass(frozen=True)`` on subclasses.
    """

    def __init_subclass__(cls):
        # allow omitting the boilerplate @dataclass in subclasses
        dataclass(cls, frozen=True)

    def __post_init__(self):
        # Field.type can contain strings; get_type_hints evaluates them
        field_types = get_type_hints(self.__class__)
        for field in fields(self):
            value = getattr(self, field.name)
            field_type = field_types[field.name]

            # always validate the type
            _validate_field_type(field.name, field_type, value)

            # use explicit validate method if it exists
            try:
                if (hasattr(value, "validate_as_field") and
                        value.validate_as_field(**field.metadata) is not NotImplemented):
                    continue
            except ConfigError as ex:
                raise ex.parent_error(field.name) from None

            # if no validate method exists, parse the metadata ourselves
            if "min" in field.metadata and value < field.metadata["min"]:
                raise ConfigError(field.name, f"%s must be at least {field.metadata['min']}")
            if "max" in field.metadata and value > field.metadata["max"]:
                raise ConfigError(field.name, f"%s must be at most {field.metadata['max']}")

            if "min_length" in field.metadata and len(value) < field.metadata["min_length"]:
                raise ConfigError(field.name, f"length of %s must be at least {field.metadata['min_length']}")
            if "max_length" in field.metadata and len(value) > field.metadata["max_length"]:
                raise ConfigError(field.name, f"length of %s must be at most {field.metadata['max_length']}")

            if "one_of" in field.metadata and value not in field.metadata["one_of"]:
                raise ConfigError(field.name, f"%s must be one of {field.metadata['one_of']}")

            try:
                if "validate" in field.metadata:
                    field.metadata["validate"](value)
            except ConfigError as ex:
                raise ex.parent_error(field.name) from None

        self.validate_self()

    def validate_self(self):
        """Validate this config object.

        This is the place to run any custom validation for non-ConfigObject fields as well as cross-field validation.
        Raise ``ConfigError`` if validation fails and make sure to call the superclass method.
        """
        pass

    def validate_as_field(self, **_kwargs):
        """Validate this config object with regard to some field metadata.

        This method is only called when a config object is a field of another config object, and it receives the
        metadata of that field as keyword arguments.

        Override this method and return something other than ``NotImplemented`` to stop the parent object from
        interpreting the field metadata further.
        """
        return NotImplemented

    def to_json(self):
        """Convert this config object to a JSON-compatible dict.

        By default, the returned dict contains all fields in this object. If a field has ``metadata["to_json"]`` set to
        a function, it is called to convert the field's value to a JSON-compatible value. If ``metadata["to_json"]``
        is set to a falsy value, the field is omitted from the JSON output. Otherwise, if the value has a ``to_json``
        method, it is called to convert the value.
        """
        result = {}
        for field in fields(self):
            value = getattr(self, field.name)
            if "to_json" in field.metadata:
                formatter = field.metadata["to_json"]
                if not formatter:
                    continue
                value = formatter(value)
            elif hasattr(value, "to_json"):
                value = value.to_json()
            result[field.name] = value
        return result


class ParseableConfigObject(ConfigObject):
    """Base class for config objects that can be parsed from a ``dict``.

    See the documentation of ``ConfigObject`` and ``from_dict`` for how these objects work.
    """

    @classmethod
    def from_dict(cls, data: dict):
        """Parses an instance of this class from the given ``dict``.

        Recursively parses fields whose type is a subclass of ``ParseableConfigObject``.

        ``Optional`` and ``Union`` fields allowing ``None`` treat missing values as ``None``. ``Optional`` also recurse
        into ``ParseableConfigObject`` types when used . Other generics, such as ``List[ParseableConfigObject]`` are
        not recursed into.
        """
        if not isinstance(data, Mapping):
            raise ConfigError(None, "%s must be a table")
        values = {}
        field_types = get_type_hints(cls)
        for field in fields(cls):
            field_type = field_types[field.name]
            optional_type = _get_optional_type(field_type)
            try:
                value = data[field.name]
            except KeyError:
                if not optional_type:
                    raise ConfigError(field.name, "%s missing")
                value = None

            # parse any sub-objects
            if isinstance(optional_type, type):
                field_type = optional_type
            if isinstance(field_type, type) and issubclass(field_type, ParseableConfigObject):
                try:
                    value = field_type.from_dict(value)
                except ConfigError as ex:
                    raise ex.parent_error(field.name) from None

            values[field.name] = value
        # create the actual object, might raise ConfigError
        return cls(**values)


def conf_field(default=MISSING, **kwargs):
    """A wrapper for ``dataclasses.field`` that passes all kwargs except for ``default`` to ``metadata``."""
    return field(default=default, metadata=kwargs)