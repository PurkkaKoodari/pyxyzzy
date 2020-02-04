from asyncio import get_event_loop

from autobahn.asyncio import WebSocketServerFactory

from pyxyzzy.server import GameSocketProtocol

SERVER_IP = "127.0.0.1"
SERVER_PORT = 9001

factory = WebSocketServerFactory(f"ws://{SERVER_IP}:{SERVER_PORT}")
factory.protocol = GameSocketProtocol

loop = get_event_loop()
coro = loop.create_server(factory, SERVER_IP, SERVER_PORT)
server = loop.run_until_complete(coro)

try:
    loop.run_forever()
except KeyboardInterrupt:
    pass
finally:
    server.close()
    loop.close()
