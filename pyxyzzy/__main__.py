import logging
import sys
from asyncio import get_event_loop
from signal import SIGTERM, SIGINT

from pyxyzzy import config
config.load()

from pyxyzzy.config import config
from pyxyzzy.server import run_server

logging.basicConfig(format="%(asctime)s [%(name)s] %(levelname)s: %(message)s", stream=sys.stderr, level=logging.INFO)
if config.server.debug:
    logging.getLogger().setLevel(logging.DEBUG)
    logging.getLogger("websockets").setLevel(logging.INFO)
    logging.getLogger("peewee").setLevel(logging.INFO)

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

server = loop.create_task(run_server(stop_server))
try:
    loop.run_until_complete(server)
except KeyboardInterrupt:
    stop_server.set_result(None)
    loop.run_until_complete(server)
