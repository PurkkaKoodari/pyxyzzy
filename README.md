# pyXyzzy

pyXyzzy is a clone of [Cards Against Humanity][cah-official]. It is modeled after [Pretend You're Xyzzy][pyx-github],
but completely rewritten from scratch using Python 3.7+, asyncio and [websockets][websockets-docs] for the backend and
[React][react] for the frontend.

Key differences from Pretend You're Xyzzy:

- **Compatibility.** When setting up the Pretend You're Xyzzy server using [WSL][wsl], I encountered numerous random
  crashes and freezes of the game server. pyXyzzy aims to use a very simple stack that should run properly almost
  anywhere.
- **Mobile UI.** pyXyzzy is built from the start with a responsive UI, so it can be used reasonably well on a mobile
  device. It can also be turned into a [Progressive Web App][pwa] with relative ease, but that is not a high priority right now. 
- **Modernization.** Pretend You're Xyzzy uses (at the time of writing) Java EE and jQuery 1.11, which creates a lot
  of boilerplate and legacy code I don't want to deal with.

The code for pyXyzzy is licensed under the [MIT license](LICENSE).

pyXyzzy is based on, but not endorsed by, [Cards Against Humanity][cah-official]. The game card data in
[pyx.sqlite](pyx.sqlite) and [cards.db](cards.db) is derived from the official game and licensed under the
[CC BY-NC-SA 2.0][cc-by-nc-sa-2.0] license.

[cah-official]: https://cardsagainsthumanity.com/
[pyx-github]: https://github.com/ajanata/PretendYoureXyzzy
[websockets-docs]: https://websockets.readthedocs.io/en/stable/index.html
[react]: https://reactjs.org/
[wsl]: https://en.wikipedia.org/wiki/Windows_Subsystem_for_Linux
[pwa]: https://en.wikipedia.org/wiki/Progressive_web_application
[cc-by-nc-sa-2.0]: https://creativecommons.org/licenses/by-nc-sa/2.0/
