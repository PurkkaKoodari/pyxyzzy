import logging
import sys
from asyncio import get_event_loop
from signal import SIGTERM, SIGINT

from websockets import serve

from pyxyzzy.game import GameServer
from pyxyzzy.server import connection_factory

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", stream=sys.stderr, level=logging.INFO)

loop = get_event_loop()
stop_server = loop.create_future()

try:
    loop.add_signal_handler(SIGINT, stop_server.set_result, None)
    loop.add_signal_handler(SIGTERM, stop_server.set_result, None)
except NotImplementedError:
    # fix signal handling on Windows
    def fix_ctrlc():
        loop.call_later(0.1, fix_ctrlc)

    if sys.platform == "win32" and sys.version_info < (3, 8):
        fix_ctrlc()


async def run_server():
    game_server = GameServer()
    async with serve(connection_factory(game_server), "127.0.0.1", 8080):
        await stop_server


server = loop.create_task(run_server())
try:
    loop.run_until_complete(server)
except KeyboardInterrupt:
    stop_server.set_result(None)
    loop.run_until_complete(server)
