from asyncio import Task, create_task, sleep
from asyncio.exceptions import CancelledError
from logging import getLogger
from random import choices
from traceback import format_stack
from typing import TypeVar, Dict, Iterable, Any, Callable, Optional, Awaitable

T = TypeVar("T")
K = TypeVar("K")
V = TypeVar("V")

LOGGER = getLogger(__name__)


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
    """Ensures that ``iterable`` and only returns one item and returns it."""
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
    """Generates a code from the given alphabet."""
    return "".join(choices(alphabet, k=length))


def create_task_log_errors(awaitable: Awaitable):
    """Wrapper for ``asyncio.create_task()`` that explicitly logs and consumes exceptions from the task."""
    stack = "".join(format_stack())

    async def wrapper():
        try:
            await awaitable
        except CancelledError:
            raise
        except Exception:
            LOGGER.error("Exception in task", exc_info=True)
            LOGGER.error("Task created at\n%s", stack)

    return create_task(wrapper())
