import sys
from dataclasses import dataclass, field
from enum import Enum
from operator import attrgetter
from typing import Generic, Callable, Hashable, Dict, Optional, Any, MutableSequence, List, Union, Iterable, TypeVar

T = TypeVar("T")

IndexType = Enum("IndexType", "NOT_NONE IGNORE_NONE ALLOW_NONE")


@dataclass
class SearchableIndex(Generic[T]):
    name: str
    converter: Callable[[T], Hashable]
    type: IndexType
    data: Dict[Hashable, T] = field(default_factory=dict, init=False)

    def __check_key(self, key: Optional[Hashable]):
        if key is None:
            if self.type == IndexType.NOT_NONE:
                raise ValueError(f"None values not allowed for index {self.name}")
            elif self.type == IndexType.IGNORE_NONE:
                return False
        return True

    def add_to_index(self, item: T):
        key = self.converter(item)
        if self.__check_key(key):
            self.data[key] = item

    def drop_from_index(self, item: T):
        key = self.converter(item)
        if self.__check_key(key):
            del self.data[key]

    def check_add(self, item: T, to_be_replaced: Any):
        key = self.converter(item)
        if self.__check_key(key):
            try:
                indexed_with_key = self.data[key]
                if indexed_with_key is not to_be_replaced:
                    raise ValueError(f"item with same {self.name} already in list")
            except KeyError:
                pass


class SearchableList(MutableSequence[T]):
    __data: List[T]
    __indices: Dict[str, SearchableIndex]

    def __init__(self, data=(), **indices: Union[Callable[[T], Hashable], IndexType]):
        """Create a new ``SearchableList`` with indices for the given attributes."""
        # initialize indices
        self.__indices = {}
        for name, function in indices.items():
            if callable(function):
                self.__indices[name] = SearchableIndex(name, function, IndexType.NOT_NONE)
            else:
                self.__indices[name] = SearchableIndex(name, attrgetter(name), function)
        # add and validate data
        self.__data = list(data)
        for item in self.__data:
            self.__check_add(item)
            self.__add_to_index(item)

    def __add_to_index(self, item: T):
        for index in self.__indices.values():
            index.add_to_index(item)

    def __drop_from_index(self, item: T):
        for index in self.__indices.values():
            index.drop_from_index(item)

    def __check_add(self, item: T, to_be_replaced: Any = object()):
        for index in self.__indices.values():
            index.check_add(item, to_be_replaced)

    def find_by(self, by: str, key: Hashable) -> T:
        """Find and return the item that has value ``key`` for the index ``index``.

        :raises KeyError: if an item with the given index value does not exist.
        :raises ValueError: if there is no index for the given attribute.
        """
        try:
            index = self.__indices[by]
        except KeyError:
            raise ValueError(f"no index called {by}") from None
        try:
            return index.data[key]
        except KeyError:
            raise KeyError(f"no item with that {index.name}") from None

    def exists(self, by: str, key: Hashable) -> bool:
        """Check if an item that has value ``key`` for the index ``index`` exists.

        :raises ValueError: if there is no index for the given attribute.
        """
        try:
            self.find_by(by, key)
        except KeyError:
            return False
        else:
            return True

    def remove_by(self, by: str, key: Hashable) -> T:
        """Remove and return the item whose ``attr`` is equal to ``key``.

        :raises KeyError: if an item with the given attribute value does not exist.
        :raises ValueError: if there is no index for the given attribute.
        """
        item = self.find_by(by, key)
        self.remove(item)
        return item

    def __iter__(self):
        return iter(self.__data)

    def __reversed__(self):
        return reversed(self.__data)

    def __contains__(self, item: object):
        return item in self.__data

    def index(self, x: Any, start: int = 0, end: int = sys.maxsize) -> int:
        return self.__data.index(x, start, end)

    def count(self, x: Any) -> int:
        return self.__data.count(x)

    def sort(self, *, key=None, reverse=False):
        # no need to modify indices
        self.__data.sort(key=key, reverse=reverse)

    def insert(self, pos: int, item: T) -> None:
        self.__check_add(item)
        self.__data.insert(pos, item)
        self.__add_to_index(item)

    def extend(self, items: Iterable[T]) -> None:
        # override: check indices first, then add values, to make the operation semi-atomic
        items = list(items)
        for item in items:
            self.__check_add(item)
        self.__data.extend(items)
        for item in items:
            self.__add_to_index(item)

    def clear(self) -> None:
        # override: just clear the indices
        for index in self.__indices.values():
            index.data.clear()
        self.__data.clear()

    def reverse(self) -> None:
        # override: no need to modify indices for reversing in-place
        self.__data.reverse()

    def __getitem__(self, pos: Union[int, slice]) -> T:
        if not isinstance(pos, int):
            raise TypeError(f"SearchableList indices must be int, not {type(pos).__name__}")
        return self.__data[pos]

    def __setitem__(self, pos: int, item: T) -> None:
        if not isinstance(pos, int):
            raise TypeError(f"SearchableList indices must be int, not {type(pos).__name__}")
        to_be_replaced = self.__data[pos]
        self.__check_add(item, to_be_replaced)
        self.__drop_from_index(to_be_replaced)
        self.__data[pos] = item
        self.__add_to_index(item)

    def __delitem__(self, pos: int) -> None:
        if not isinstance(pos, int):
            raise TypeError(f"SearchableList indices must be int, not {type(pos).__name__}")
        to_be_deleted = self.__data[pos]
        self.__drop_from_index(to_be_deleted)
        del self.__data[pos]

    def __len__(self) -> int:
        return len(self.__data)
