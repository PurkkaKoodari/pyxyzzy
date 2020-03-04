from asyncio import Task, create_task, sleep
from random import choice
from typing import TypeVar, Dict, Iterable, Any, Callable, Optional

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")


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


def generate_code(alphabet, length):
    return "".join(choice(alphabet) for _ in range(length))
