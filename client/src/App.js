import React, { useCallback, useRef, useState, useEffect } from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import GameSocket from "./GameSocket"
import LoginScreen from "./LoginScreen"
import ConfigContext from "./ConfigContext"

const SERVER_URL = "ws://localhost:8080/ws"

const App = () => {
  const [connectionState, setConnectionState] = useState("connecting")
  const [config, setConfig] = useState(null)
  const [retryTime, setRetryTime] = useState(0)
  const [user, setUser] = useState(null)

  const [game, setGame] = useState(null)
  const [gameOptions, setGameOptions] = useState(null)
  const [hand, setHand] = useState([])
  const [players, setPlayers] = useState([])
  const [chatMessages, setChatMessages] = useState([])

  const connectionRef = useRef()

  const handleConnectionState = useCallback((state, reconnectIn) => {
    setConnectionState(state)
    setRetryTime(reconnectIn)
  }, [])
  const handleConfig = useCallback((config) => {
    setConfig(config)
  }, [])
  const handleUser = useCallback((user) => {
    setUser(user)
    // if we get logged out, forget the game
    if (!user) setGame(null)
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
    
  }, [])

  let gameScreen = null, connectingScreen = null
  if (user && game) {
    gameScreen =
      <GameScreen
        connection={connectionRef.current}
        game={game}
        gameOptions={gameOptions}
        hand={hand}
        players={players} />
  } else if (user) {
    gameScreen = 
      <GameList
        connection={connectionRef.current}
        user={user} />
  } else if (config) {
    gameScreen = 
      <LoginScreen
        connection={connectionRef.current} />
  }
  if (connectionState !== "connected") {
    connectingScreen = <ConnectingScreen state={connectionState} retryTime={retryTime} />
  }

  useEffect(() => {
    document.documentElement.classList.toggle("connecting", connectionState !== "connected")
  }, [connectionState])

  return (
    <ConfigContext.Provider value={config}>
      {gameScreen}
      {connectingScreen}
      <GameSocket
        ref={connectionRef}
        url={SERVER_URL}
        connect={true}
        onUpdate={handleUpdate}
        onEvent={handleEvent}
        setState={handleConnectionState}
        setUser={handleUser}
        setConfig={handleConfig} />
    </ConfigContext.Provider>
  )
}

export default App
