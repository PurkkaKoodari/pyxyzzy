import log from "loglevel"
import {uniqueId} from "./utils"
import {AppState, UserSession} from "./state"
import {AuthenticateResponse, UpdateGame, UpdateOptions, UpdatePlayer, UpdateRoot, UpdateWhiteCard} from "./api"

/**
 * The UI version is sent to the server in the handshake and compared to see if we are using an outdated frontend from
 * the browser cache.
 */
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

interface WritableUpdateRoot extends UpdateRoot {
  game: UpdateGame
  players: readonly UpdatePlayer[]
  hand: readonly UpdateWhiteCard[]
  options: UpdateOptions
  [key: string]: UpdateGame | readonly UpdatePlayer[] | readonly UpdateWhiteCard[] | UpdateOptions
}

export type ConnectionState = "connect" | "reconnect" | "connected" | "retry_sleep" | "retry_reconnect" | "connected_elsewhere" | "protocol_error"

/**
 * Manages the WebSocket connection for the game, handles authentication, API calls and tracks state updates.
 */
export default class GameSocket {
  // the websocket url
  private url: string | null = null
  // global app state
  private readonly appState: AppState

  // called when the (client-facing) connection state changes
  onConnectionStateChange: (status: ConnectionState, retryIn?: number) => void = () => {}
  // called when a config is received from the server
  onConfigChange: (config: any) => void = () => {}
  // called when automatic re-login fails (the session doesn't exist on the server)
  onReloginFailed: () => void = () => {}

  // WebSocket instance
  private socket: WebSocket | null = null

  // true when websocket connected
  private connected = false
  // true when connected & can authenticate
  private handshaked = false
  // true when connected & user logged in
  private authenticated = false
  // true when disconnect() has been called
  private closeRequested = false

  // seconds to sleep before attempting to reconnect
  private reconnectDelay = 0
  // setTimeout id for sleeping before reconnection
  private reconnectTimeout: any
  // number of started connection attempts since last successful connection
  private connectAttempts = 0

  // promises for ongoing API calls
  private readonly ongoingCalls: {[key: number]: ApiCall<any>} = {}

  // stored session for relogin
  private session = getSessionFromStorage()

  // stored game state JSON for delta updates
  private gameStateJson: Partial<WritableUpdateRoot> = {}

  constructor(appState: AppState) {
    this.appState = appState
  }

  /**
   * Sets the WebSocket connection URL and opens the connection. May only be called once.
   * @param url the WebSocket URL
   */
  connect(url: string) {
    if (this.url !== null)
      throw new Error("GameSocket.connect() may only be called once")
    this.url = url
    this.doConnect()
  }

  /**
   * Closes this connection permanently.
   */
  disconnect() {
    this.closeRequested = true
    clearTimeout(this.reconnectTimeout)
    if (this.socket !== null)
      this.socket.close()
    this.handleDisconnection()
  }

  /**
   * Logs in with a new session using the given username. Relogins are automatically handled by GameSocket.
   * @param name the username to use
   */
  async login(name: string) {
    await this.doAuthenticate({ name })
  }

  /**
   * Logs out of the current session, keeping the connection open.
   */
  async logout() {
    // delete the session from storage before contacting the server to ensure at least a client-side logout
    saveSessionInStorage(null)
    await this.call("log_out", {}, false)
    this.authenticated = false
    this.removeSession()
  }

  private setSession(session: UserSession | null) {
    this.session = session
    saveSessionInStorage(session)
    this.appState.updateSession(session)

    if (session === null) {
      // if the session no longer exists, cancel any calls as we don't want to persist them to the next session
      for (const call of Object.values(this.ongoingCalls)) {
        call.fail("disconnected", "session closed")
        delete this.ongoingCalls[call.call_id]
      }
      // also reset all game state and dispatch the blank state
      this.gameStateJson = {}
      this.dispatchUpdatedGameState()
    }
  }

  private removeSession() {
    this.setSession(null)
  }

  private doConnect() {
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
        version: UI_VERSION
      }))
    })

    ws.addEventListener("close", (e) => {
      // if we closed the connection ourselves, don't mind disconnection
      if (this.closeRequested)
        return
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

    ws.addEventListener("message", async (e: MessageEvent) => {
      // if we are closing the connection, ignore messages
      if (this.closeRequested)
        return
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
          await this.doRelogin()
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

      // handle responses to calls and state updates
      if ("call_id" in data)
        this.handleCallResult(data)
      else
        this.handleUpdate(data)
    })
  }

  private handleCallResult(data: any) {
    // find the corresponding promise
    const call = this.ongoingCalls[data.call_id]
    if (!call)
      throw new Error("got response to unknown call from server")

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
  }

  private handleUpdate(data: any) {
    // ignore state updates when logged out
    if (!this.session)
      return

    log.debug("UPDATE", data)

    // reset all game state data when leaving a game
    if (data.game === null && this.gameStateJson.game !== null)
      this.gameStateJson = {}

    let updated = false
    for (const key of ["game", "hand", "players", "options"]) {
      if (key in data) {
        this.gameStateJson[key] = data[key]
        updated = true
      }
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
  }

  private dispatchUpdatedGameState() {
    // only pass updates on when all update keys have been received
    if (!["game", "options", "hand", "players"].every(attr => attr in this.gameStateJson)
        || this.gameStateJson.game === null) {
      this.appState.updateGameState(null)
    } else {
      this.appState.updateGameState(this.gameStateJson as UpdateRoot)
    }
  }

  private async doRelogin() {
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
        this.onReloginFailed()
      }
    }
  }

  private async doAuthenticate(params: object) {
    const response = await this.call<AuthenticateResponse>("authenticate", params, false)
    const session = new UserSession(response)
    this.authenticated = true
    // send persistent calls from previous connection (before notifying the client, as that might cause new calls)
    for (const call of Object.values(this.ongoingCalls))
      call.send()
    // now notify the client of the new session
    this.setSession(session)
    this.onConnectionStateChange("connected")
    return true
  }

  private updateReconnectionTimer() {
    if (this.reconnectDelay <= 0) {
      this.onConnectionStateChange(this.connectAttempts > 0 ? "retry_reconnect" : "reconnect")
      this.doConnect()
    } else {
      this.onConnectionStateChange(this.connectAttempts > 0 ? "retry_sleep" : "reconnect", this.reconnectDelay)
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectDelay -= 1
        this.updateReconnectionTimer()
      }, Math.min(1000, this.reconnectDelay * 1000))
    }
  }

  private handleDisconnection() {
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

  private handleProtocolError() {
    this.disconnect()
    this.onConnectionStateChange("protocol_error")
    setTimeout(() => window.location.reload(), 2000)
  }

  /**
   * Asynchronously sends a call to the API over WebSocket and returns the result.
   * @param action the API action name
   * @param data the call parameters, if any
   * @param persistent `true` to resend ongoing calls after reconnection (otherwise they fail on disconnection)
   */
  async call<R>(action: string, data: any = {}, persistent = false) {
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

      const canSendNow = action === "authenticate" ? this.handshaked : this.authenticated
      if (!canSendNow && !persistent) {
        call.fail("disconnected", "not connected to server")
        return
      }

      this.ongoingCalls[call_id] = call
      if (canSendNow)
        call.send()
    })
  }
}
