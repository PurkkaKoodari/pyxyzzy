from asyncio import Task, create_task, sleep
from typing import MutableSequence, TypeVar, Union, List, Dict, Hashable, Iterable, Any, Callable, Tuple, Optional

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")


class SearchableList(MutableSequence[T]):
    __data: List[T]
    __indices: Dict[str, Tuple[Callable[[T], Hashable], Dict[Hashable, T]]]

    def __init__(self, data=(), **indices: Union[Callable[[T], Any], Any]):
        """Create a new ``SearchableList`` with indices for the given attributes."""
        # initialize indices
        self.__indices = {}
        for name, function in indices.items():
            function = function if callable(function) else lambda obj: getattr(obj, name)
            self.__indices[name] = (function, {})
        # add and validate data
        self.__data = list(data)
        for item in self.__data:
            self.__check_add(item)
            self.__add_to_index(item)

    def __add_to_index(self, item: T):
        for function, index in self.__indices.values():
            key = function(item)
            index[key] = item

    def __drop_from_index(self, item: T):
        for function, index in self.__indices.values():
            key = function(item)
            del index[key]

    def __check_add(self, item: T, to_be_replaced: Any = object()):
        for name, (function, index) in self.__indices.items():
            key = function(item)
            try:
                indexed_with_key = index[key]
                if indexed_with_key is not to_be_replaced:
                    raise ValueError(f"item with same {name} already in list")
            except KeyError:
                pass

    def find_by(self, index: str, key: Hashable):
        """Find and return the item that has value ``key`` for the index ``index``.

        :raises KeyError: if an item with the given index value does not exist.
        :raises ValueError: if there is no index for the given attribute.
        """
        try:
            _, index_data = self.__indices[index]
        except KeyError:
            raise ValueError(f"no index called {index}") from None
        try:
            return index_data[key]
        except KeyError:
            raise KeyError(f"no item with that {index}") from None

    def exists(self, index: str, key: Hashable):
        """Check if an item that has value ``key`` for the index ``index`` exists.

        :raises ValueError: if there is no index for the given attribute.
        """
        try:
            self.find_by(index, key)
        except KeyError:
            return False
        else:
            return True

    def remove_by(self, attr: str, key: Hashable):
        """Remove and return the item whose ``attr`` is equal to ``key``.

        :raises KeyError: if an item with the given attribute value does not exist.
        :raises ValueError: if there is no index for the given attribute.
        """
        item = self.find_by(attr, key)
        self.remove(item)
        return item

    def __iter__(self):
        return iter(self.__data)

    def __reversed__(self):
        return reversed(self.__data)

    def __contains__(self, item: object):
        return item in self.__data

    def index(self, x: Any, start: int = 0, end: int = None) -> int:
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
        for _, index in self.__indices.values():
            index.clear()
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


class CallbackTimer:
    __task: Optional[Task] = None

    def start(self, time: float, callback: Callable[[], Any]) -> None:
        self.cancel()

        async def task():
            await sleep(time)
            self.cancel()
            callback()

        self.__task = create_task(task())

    def cancel(self) -> None:
        if self.__task:
            self.__task.cancel()

    def is_running(self) -> bool:
        return self.__task is not None


def single(iterable: Iterable[T]) -> T:
    it = iter(iterable)
    try:
        value = next(it)
    except StopIteration:
        raise ValueError("expected a single value from iterator, got none")
    try:
        next(it)
        raise ValueError("expected a single value from iterator, got more")
    except StopIteration:
        return value


class FunctionRegistry(Dict[K, V]):
    def register(self, key: K) -> Callable[[V], V]:
        def _decorator(function):
            if key in self:
                raise ValueError(f"key {key} already registered")
            self[key] = function
            return function

        return _decorator
