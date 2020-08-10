import React, {useEffect, useState} from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import GameSocket from "./GameSocket"
import LoginScreen from "./LoginScreen"
import {ConfigContext, ConnectionContext, EventContext, UserContext} from "./contexts"
import {GameState, UserSession} from "./state"
import {GameEventHandler} from "./events"

const SERVER_URL = "ws://localhost:8080/ws"

const App = () => {
  const [connectionState, setConnectionState] = useState("connect")
  const [config, setConfig] = useState<any>(null)
  const [retryTime, setRetryTime] = useState<number | undefined>(0)
  const [user, setUser] = useState<UserSession | null>(null)

  const [connection, setConnection] = useState<GameSocket | null>(null)
  const [eventHandler, setEventHandler] = useState<GameEventHandler | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [chatMessages, setChatMessages] = useState<any[]>([])

  useEffect(() => {
    const connection = new GameSocket(SERVER_URL)
    const eventHandler = new GameEventHandler(connection, setChatMessages)

    connection.onConnectionStateChange = (state, reconnectIn) => {
      setConnectionState(state)
      setRetryTime(reconnectIn)
    }
    connection.onConfigChange = config => setConfig(config)
    connection.onSessionChange = user => {
      setUser(user)
      eventHandler.user = user
    }

    connection.onGameStateChange = gameState => setGame(gameState)
    connection.onGameEvent = event => eventHandler.handle(event)

    connection.connect()
    setConnection(connection)
    setEventHandler(eventHandler)

    return () => connection.disconnect()
  }, [])

  let gameScreen = null, connectingScreen = null
  if (user && game) {
    gameScreen = <GameScreen game={game} chatMessages={chatMessages} />
  } else if (user) {
    gameScreen = <GameList chatMessages={chatMessages} />
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
    <ConnectionContext.Provider value={connection}>
      <EventContext.Provider value={eventHandler}>
        <ConfigContext.Provider value={config}>
          <UserContext.Provider value={user}>
            {gameScreen}
            {connectingScreen}
          </UserContext.Provider>
        </ConfigContext.Provider>
      </EventContext.Provider>
    </ConnectionContext.Provider>
  )
}

export default App
