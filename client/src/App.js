import React, { useCallback, useRef, useState, useEffect } from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import GameSocket from "./GameSocket"
import LoginScreen from "./LoginScreen"
import { ConfigContext, ConnectionContext, UserContext } from "./contexts"

const SERVER_URL = "ws://localhost:8080/ws"

const App = () => {
  const [connectionState, setConnectionState] = useState("connecting")
  const [config, setConfig] = useState(null)
  const [retryTime, setRetryTime] = useState(0)
  const [user, setUser] = useState(null)

  const [game, setGame] = useState(null)
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
    // if we receive game=null, that means we've left the game
    if ("game" in update && !update.game) {
      setGame(null)
      return
    }
    // update only relevant fields of game and avoid unnecessary updates
    let updated = game
    for (const field of ["game", "options", "hand", "players"]) {
      if (field in update) {
        updated = { ...updated }
        updated[field] = update[field]
      }
    }
    if (updated !== game) {
      setGame(updated)
    }
  }, [])

  const handleEvent = useCallback((event) => {
    
  }, [])

  let gameScreen = null, connectingScreen = null
  if (user && game) {
    gameScreen = <GameScreen game={game} />
  } else if (user) {
    gameScreen = <GameList />
  } else if (config) {
    gameScreen = <LoginScreen />
  }
  if (connectionState !== "connected") {
    connectingScreen = <ConnectingScreen state={connectionState} retryTime={retryTime} />
  }

  useEffect(() => {
    document.documentElement.classList.toggle("connecting", connectionState !== "connected")
  }, [connectionState])

  return (
    <ConfigContext.Provider value={config}>
      <ConnectionContext.Provider value={connectionRef.current}>
        <UserContext.Provider value={user}>
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
        </UserContext.Provider>
      </ConnectionContext.Provider>
    </ConfigContext.Provider>
  )
}

export default App
