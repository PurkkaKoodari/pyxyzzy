import React, {Component} from "react"
import "react-toastify/dist/ReactToastify.css"
import "./App.scss"
import ConnectingScreen from "./ConnectingScreen"
import GameList from "./GameList"
import GameScreen from "./GameScreen"
import LoginScreen from "./LoginScreen"
import {ActingContext, AppStateContext, ConfigContext, GameContext, UserContext} from "./contexts"
import {AppState, GameState, UserSession} from "../state"
import {ConfigRoot} from "../api"

const SERVER_URL = `ws://${window.location.hostname}:8080/ws`

class AppComponentState {
  appState: AppState

  connectionState: string = "connect"
  config: ConfigRoot | null = null
  retryTime: number | undefined

  userSession: UserSession | null = null
  gameState: GameState | null = null
  chatMessages: any[] = []
  acting: boolean = false

  constructor(appState: AppState) {
    this.appState = appState
  }

}

class App extends Component<{}, AppComponentState> {
  constructor(props: {}) {
    super(props)

    const appState = new AppState()

    appState.messageHandler.onChatMessagesChange = chatMessages => this.setState({chatMessages})

    appState.connection.onConnectionStateChange = (connectionState, retryTime) => {
      this.setState({connectionState, retryTime})
      document.documentElement.classList.toggle("connecting", connectionState !== "connected")
    }
    appState.connection.onConfigChange = config => this.setState({config})

    appState.onUserUpdated = userSession => this.setState({userSession})
    appState.onGameStateUpdated = gameState => this.setState({gameState})
    appState.onActingChanged = acting => this.setState({acting})

    this.state = new AppComponentState(appState)
  }

  componentDidMount() {
    this.state.appState.connection.connect(SERVER_URL)
  }

  componentWillUnmount() {
    this.state.appState.connection.disconnect()
  }

  render() {
    const {appState, config, userSession, gameState, chatMessages, acting, connectionState, retryTime} = this.state

    let gameScreen = null, connectingScreen = null
    if (userSession && gameState) {
      gameScreen = <GameScreen chatMessages={chatMessages} />
    } else if (userSession) {
      gameScreen = <GameList chatMessages={chatMessages} />
    } else if (config && connectionState !== "connect") {
      gameScreen = <LoginScreen />
    }
    if (connectionState !== "connected") {
      connectingScreen = <ConnectingScreen state={connectionState} retryTime={retryTime} />
    }

    return (
        <ConfigContext.Provider value={config}>
          <AppStateContext.Provider value={appState}>
            <UserContext.Provider value={userSession}>
              <GameContext.Provider value={gameState}>
                <ActingContext.Provider value={acting}>
                  {gameScreen}
                  {connectingScreen}
                </ActingContext.Provider>
              </GameContext.Provider>
            </UserContext.Provider>
          </AppStateContext.Provider>
        </ConfigContext.Provider>
    )
  }
}

export default App
