import React, { useCallback, useRef, useState, useEffect } from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import GameSocket from "./GameSocket"
import LoginScreen from "./LoginScreen"

const SERVER_URL = "ws://localhost:8080/ws"

const App = () => {
  const [connectionState, setConnectionState] = useState("connecting")
  const [retryTime, setRetryTime] = useState(0)
  const [user, setUser] = useState(null)

  const [game, setGame] = useState(null)
  const [gameOptions, setGameOptions] = useState(null)
  const [hand, setHand] = useState([])
  const [players, setPlayers] = useState([])
  const [chatMessages, setChatMessages] = useState([])

  const connectionRef = useRef()

  const handleConnectionState = useCallback((state) => {
    setConnectionState(state.connection)
    if ("reconnectIn" in state) setRetryTime(state.reconnectIn)
    setUser(state.user)
    if (!state.user) setGame(null)
  }, [])

  const handleUpdate = useCallback((update) => {
    if ("game" in update) {
      setGame(update.game)
    }
    if ("options" in update) {
      setGameOptions(update.options)
    }
    if ("hand" in update) {
      setHand(update.hand)
    }
    if ("players" in update) {
      setPlayers(update.players)
    }
  }, [])

  const handleEvent = useCallback((event) => {
    console.log(event)
  }, [])

  let gameScreen, connectingScreen = null
  if (user && game) {
    gameScreen = (
      <GameScreen connection={connectionRef.current} game={game} gameOptions={gameOptions} hand={hand} players={players} />
    )
  } else if (user) {
    gameScreen = (
      <GameList connection={connectionRef.current} user={user} />
    )
  } else {
    gameScreen = (
      <LoginScreen connection={connectionRef.current} />
    )
  }
  if (connectionState !== "connected") {
    connectingScreen = <ConnectingScreen state={connectionState} retryTime={retryTime} />
  }

  useEffect(() => {
    document.documentElement.classList.toggle("connecting", connectionState !== "connected")
  }, [connectionState])

  return (
    <>
      {gameScreen}
      {connectingScreen}
      <GameSocket
        ref={connectionRef}
        url={SERVER_URL}
        connect={true}
        onUpdate={handleUpdate}
        onEvent={handleEvent}
        onStateChange={handleConnectionState} />
    </>
  )
}

export default App
