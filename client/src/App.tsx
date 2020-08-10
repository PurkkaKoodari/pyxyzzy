import React, { useState, useEffect } from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import GameSocket from "./GameSocket"
import LoginScreen from "./LoginScreen"
import { ConfigContext, ConnectionContext, UserContext } from "./contexts"
import {GameState, UserSession} from "./state"

const SERVER_URL = "ws://localhost:8080/ws"

class EventHandler {
  chatMessages: any[] = []
  onChatMessagesChange: any

  constructor(onChatMessagesChange: any) {
    this.onChatMessagesChange = onChatMessagesChange
  }

  addChatMessage(message: any) {
    this.chatMessages.push(message)
    this.onChatMessagesChange(this.chatMessages)
  }

  handle(event: any) {
    switch (event.type) {
      // TODO
    }
  }
}

const App = () => {
  const [connectionState, setConnectionState] = useState("connect")
  const [config, setConfig] = useState<any>(null)
  const [retryTime, setRetryTime] = useState<number | undefined>(0)
  const [user, setUser] = useState<UserSession | null>(null)

  const [connection, setConnection] = useState<GameSocket | null>(null)
  const [game, setGame] = useState<GameState | null>(null)
  const [chatMessages, setChatMessages] = useState([])

  useEffect(() => {
    const eventHandler = new EventHandler(setChatMessages)
    const connection = new GameSocket(SERVER_URL)

    connection.onConnectionStateChange = (state, reconnectIn) => {
      setConnectionState(state)
      setRetryTime(reconnectIn)
    }
    connection.onConfigChange = config => setConfig(config)
    connection.onSessionChange = user => setUser(user)

    connection.onGameStateChange = gameState => setGame(gameState)
    connection.onGameEvent = event => eventHandler.handle(event)

    connection.connect()
    setConnection(connection)

    return () => connection.disconnect()
  }, [])

  let gameScreen = null, connectingScreen = null
  if (user && game) {
    gameScreen = <GameScreen game={game} chatMessages={chatMessages} />
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
      <ConnectionContext.Provider value={connection}>
        <UserContext.Provider value={user}>
          {gameScreen}
          {connectingScreen}
        </UserContext.Provider>
      </ConnectionContext.Provider>
    </ConfigContext.Provider>
  )
}

export default App
