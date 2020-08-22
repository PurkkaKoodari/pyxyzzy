import log from "loglevel"
import {uniqueId} from "./utils"
import {AppState, UserSession} from "./state"
import {AuthenticateResponse, UpdateRoot} from "./api"

const UI_VERSION = "0.1-a1"

const INITIAL_RECONNECT_INTERVAL = .5
const MAX_RECONNECT_INTERVAL = 15

const SESSION_STORAGE_KEY = "pyXyzzy.session"

const getSessionFromStorage = () => {
  try {
    const sessionJson = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!sessionJson) return null
    const session = JSON.parse(sessionJson)
    if (!("id" in session && "token" in session)) return null
    return new UserSession(session)
  } catch (_) {
    return null
  }
}

const saveSessionInStorage = (session: UserSession | null) => {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

class ApiError extends Error {
  code: string
  description: string

  constructor(code: string, description: string) {
    super(`[${code}] ${description}`)
    this.name = "ApiError"
    this.code = code
    this.description = description
  }
}

interface ApiCall<R> {
  call_id: number
  persistent: boolean
  send(): void
  success(result: R): void
  fail(code: string, description: string): void
}

export default class GameSocket {
  // the websocket url
  url: string | null = null
  // global app state
  appState: AppState

  // called when the (client-facing) connection state changes
  onConnectionStateChange: (status: string, retryIn?: number) => void = () => {}
  // called when a config is received from the server
  onConfigChange: (config: any) => void = () => {}

  // WebSocket instance
  socket: WebSocket | null = null

  // true when websocket connected
  connected = false
  // true when connected & can authenticate
  handshaked = false
  // true when connected & user logged in
  authenticated = false
  // true when disconnect() has been called
  closeRequested = false

  // seconds to sleep before attempting to reconnect
  reconnectDelay = 0
  // setTimeout id for sleeping before reconnection
  reconnectTimeout: any
  // number of started connection attempts since last successful connection
  connectAttempts = 0

  // promises for ongoing API calls
  ongoingCalls: { [key: number]: ApiCall<any> } = {}

  // stored session for relogin
  session = getSessionFromStorage()

  // stored game state JSON for delta updates
  gameStateJson: Partial<UpdateRoot> = {}

  constructor(appState: AppState) {
    this.appState = appState
  }

  disconnect() {
    this.closeRequested = true
    clearTimeout(this.reconnectTimeout)
    if (this.socket !== null)
      this.socket.close()
    this.handleDisconnection()
  }

  async login(name: string) {
    await this.doAuthenticate({ name })
  }

  async logout() {
    // delete the session from storage before contacting the server to ensure at least a client-side logout
    saveSessionInStorage(null)
    await this.call("log_out", {}, false)
    this.authenticated = false
    this.removeSession()
  }

  setSession(session: UserSession | null) {
    this.session = session
    saveSessionInStorage(session)
    this.appState.updateSession(session)
    // reset game state when session closes
    if (session === null) {
      this.gameStateJson = {}
      this.dispatchUpdatedGameState()
    }
  }

  removeSession() {
    this.setSession(null)
  }

  connect(url: string) {
    this.url = url
    this.openConnection()
  }

  openConnection() {
    log.debug("opening websocket")
    const ws = new WebSocket(this.url!)
    this.socket = ws
    this.connectAttempts++

    ws.addEventListener("open", () => {
      // send handshake when connection is opened
      log.debug("connected, sending version")
      this.connectAttempts = 0
      this.connected = true
      this.socket!.send(JSON.stringify({
        "version": UI_VERSION
      }))
    })

    ws.addEventListener("close", (e) => {
      // if we closed the connection ourselves, don't mind disconnection
      if (this.closeRequested) return
      // if the close is due to a protocol error, reload the page
      if (e.code === 1003) {
        log.error(`connection closed due to protocol error: ${e.reason}`)
        this.handleProtocolError()
        return
      }
      // update state and schedule a reconnect
      log.debug("connection lost")
      this.handleDisconnection()
      this.reconnectDelay = Math.min(MAX_RECONNECT_INTERVAL, INITIAL_RECONNECT_INTERVAL * 2 ** this.connectAttempts)
      this.updateReconnectionTimer()
    })

    ws.addEventListener("message", (e: MessageEvent) => {
      // if we are closing the connection, ignore messages
      if (this.closeRequested) return
      // all messages are JSON
      const data = JSON.parse(e.data)

      // first response from server is the handshake response, process it first
      if (!this.handshaked) {
        if ("error" in data) {
          // handshake failed, usually due to cached UI
          log.error(`handshake failed: ${data.error}`)
          this.handleProtocolError()
          return
        }
        // successful handshake returns the configuration
        log.debug("config received", data.config)
        this.onConfigChange(data.config)
        this.handshaked = true
        // log in with existing session if one exists
        if (this.session !== null) {
          // doRelogin will reauthenticate and mark the connection as connected when done
          this.doRelogin()
        } else {
          this.onConnectionStateChange("connected")
        }
        return
      }

      // handle the server asking us to disconnect because another tab was opened
      if ("disconnect" in data && data.disconnect === "connected_elsewhere") {
        log.debug("connected elsewhere, disconnecting")
        this.disconnect()
        this.onConnectionStateChange("connected_elsewhere")
        return
      }

      // handle responses to calls
      else if ("call_id" in data) {
        // find the corresponding promise
        const call = this.ongoingCalls[data.call_id]
        if (!call) throw new Error("got response to unknown call from server")
        if (data.error) {
          // pass error to caller via promise
          call.fail(data.error, data.description)
          // if error occurs due to missing authentication, reset the session
          // TODO: this might cause problems if some kind of desync can cause
          //  calls to be made while the socket is not authenticated; this could
          //  cause the saved session to be lost even if it is valid
          if (data.error === "not_authenticated") {
            this.authenticated = false
            this.removeSession()
            this.onConnectionStateChange("connected")
          }
        } else {
          // pass result to caller via promise
          call.success(data)
        }
        // call finished, forget it
        delete this.ongoingCalls[data.call_id]
        return
      }

      // ignore state updates when logged out
      if (!this.session)
        return

      // handle state updates
      log.debug("UPDATE", data)

      // reset all game state data when leaving a game
      if (data.game === null && this.gameStateJson.game !== null)
        this.gameStateJson = {}

      let updated = false
      if ("game" in data) {
        this.gameStateJson.game = data.game
        updated = true
      }
      if ("hand" in data) {
        this.gameStateJson.hand = data.hand
        updated = true
      }
      if ("players" in data) {
        this.gameStateJson.players = data.players
        updated = true
      }
      if ("options" in data) {
        this.gameStateJson.options = data.options
        updated = true
      }
      if (updated)
        this.dispatchUpdatedGameState()

      // handle game events
      if ("events" in data) {
        for (const event of data.events) {
          log.debug("EVENT", event)
          this.appState!.handleEvent(event)
        }
      }
    })
  }

  dispatchUpdatedGameState() {
    if (!["game", "options", "hand", "players"].every(attr => attr in this.gameStateJson) || this.gameStateJson.game === null) {
      this.appState.updateGameState(null)
    } else {
      this.appState.updateGameState(this.gameStateJson as UpdateRoot)
    }
  }

  async doRelogin() {
    try {
      await this.doAuthenticate({
        id: this.session!.id,
        token: this.session!.token
      })
    } catch (error) {
      if (error.code !== "disconnected") {
        // relogin failed, reset session
        this.removeSession()
        // set the connection state so that the client knows it can reauthenticate manually
        this.onConnectionStateChange("connected")
      }
    }
  }

  async doAuthenticate(params: object) {
    const response = await this.call<AuthenticateResponse>("authenticate", params, false)
    const session = new UserSession(response)
    this.authenticated = true
    // send persistent calls from previous connection (before notifying the client, as that might cause new calls)
    for (const call of Object.values(this.ongoingCalls)) {
      call.send()
    }
    this.setSession(session)
    this.onConnectionStateChange("connected")
    return true
  }

  updateReconnectionTimer() {
    if (this.reconnectDelay <= 0) {
      this.onConnectionStateChange(this.connectAttempts > 0 ? "retry_reconnect" : "reconnect")
      this.openConnection()
    } else {
      this.onConnectionStateChange(this.connectAttempts > 0 ? "retry_sleep" : "reconnect", this.reconnectDelay)
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectDelay -= 1
        this.updateReconnectionTimer()
      }, Math.min(1000, this.reconnectDelay * 1000))
    }
  }

  handleDisconnection() {
    this.connected = false
    this.handshaked = false
    this.authenticated = false
    this.socket = null
    for (const call of Object.values(this.ongoingCalls)) {
      if (!call.persistent) {
        call.fail("disconnected", "lost connection to server")
        delete this.ongoingCalls[call.call_id]
      }
    }
  }

  handleProtocolError() {
    this.disconnect()
    this.onConnectionStateChange("protocol_error")
    setTimeout(() => window.location.reload(), 2000)
  }

  async call<R>(action: string, data: object = {}, persistent = false) {
    const thisSocket = this
    return await new Promise<R>((resolve, reject) => {
      const call_id = uniqueId()
      const request = {
        action,
        call_id,
        ...data
      }
      const call: ApiCall<R> = {
        call_id,
        persistent,
        success(result: R) {
          log.debug(`${call_id} <`, result)
          resolve(result)
        },
        fail(code: string, description: string) {
          log.debug(`${call_id} FAILED ${code} ${description}`)
          reject(new ApiError(code, description))
        },
        send() {
          thisSocket.socket!.send(JSON.stringify(request))
        }
      }
      log.debug(`${call_id} > ${action}`, data)

      const canPerformInCurrentState = action === "authenticate" ? this.handshaked : this.authenticated
      if (!canPerformInCurrentState && !persistent) {
        call.fail("disconnected", "not connected to server")
        return
      }

      this.ongoingCalls[call_id] = call
      if (canPerformInCurrentState) call.send()
    })
  }
}
