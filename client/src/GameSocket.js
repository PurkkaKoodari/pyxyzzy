import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import log from "loglevel"
import { uniqueId } from "./utils"

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
    return session
  } catch (_) {
    return null
  }
}

class ApiError extends Error {
  constructor(code, description) {
    super(`[${code}] ${description}`)
    this.name = "ApiError"
    this.code = code
    this.description = description
  }
}

// Because there seems to be no other sane way to integrate WebSockets with React,
// the component enforces that the callbacks must not change (i.e. they must just take
// the event and pass it to some app-level setState). Additionally, changing the URL
// is not supported.
// The following line disables the warning for not monitoring the parameters, as there's
// no point in wrapping literally everything in useCallback and similar. If the parameters
// change, the useEffect hook throws.

/* eslint-disable react-hooks/exhaustive-deps */

const GameSocket = forwardRef(({ url, onEvent, onUpdate, setState, setUser, setConfig }, ref) => {
  const renderCount = useRef(0)

  useEffect(() => {
    if (++renderCount.current > 1) {
      throw new Error("the parameters for GameSocket must not change")
    }
  }, [url, onEvent, onUpdate, setState, setConfig])

  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function")
  if (typeof onUpdate !== "function") throw new TypeError("onUpdate must be a function")
  if (typeof setState !== "function") throw new TypeError("setState must be a function")
  if (typeof setUser !== "function") throw new TypeError("setUser must be a function")
  if (typeof setConfig !== "function") throw new TypeError("setConfig must be a function")

  const state = useRef({
    socket: null,
    connected: false,
    handshaked: false,
    authenticated: false,
    closing: false,
    reconnectTimeout: -1,
    connectAttempts: 0,
    ongoing: {},
    session: false,
  }).current

  if (state.session === false) state.session = getSessionFromStorage()

  const saveSession = (session) => {
    state.session = session
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  }

  const disconnected = () => {
    state.connected = false
    state.handshaked = false
    state.authenticated = false
    state.socket = null
    for (const call of Object.values(state.ongoing)) {
      if (!call.persistent) {
        call.fail("disconnected", "lost connection to server")
        delete state.ongoing[call.call_id]
      }
    }
  }

  const doConnect = () => {
    log.debug("opening websocket")
    const ws = new WebSocket(url)
    state.socket = ws
    state.connectAttempts++

    ws.addEventListener("open", (e) => {
      // send handshake
      log.debug("connected, sending version")
      state.connectAttempts = 0
      state.connected = true
      state.socket.send(JSON.stringify({
        "version": UI_VERSION
      }))
    })
    ws.addEventListener("close", (e) => {
      // if we closed the connection ourselves, don't mind disconnection
      if (state.closing) return
      // if the close is due to a protocol error, reload the page
      if (e.code === 1003) {
        log.error(`connection closed due to protocol error: ${e.reason}`)
        handleProtocolError()
        return
      }
      // update state and schedule a reconnect
      log.debug("connection lost")
      disconnected()
      let delay = Math.min(MAX_RECONNECT_INTERVAL, INITIAL_RECONNECT_INTERVAL * 2 ** state.connectAttempts)
      state.reconnectTimeout = setTimeout(doConnect, delay * 1000)
      setState(state.connectAttempts > 0 ? "retrying" : "reconnecting", delay)
    })
    ws.addEventListener("message", (e) => {
      // if we are closing the connection, ignore messages
      if (state.closing) return
      // all messages are JSON
      const data = JSON.parse(e.data)
      if (!state.handshaked) {
        // first response from server is the handshake response
        if ("error" in data) {
          // handshake failed, usually due to cached UI
          log.error(`handshake failed: ${data.error}`)
          handleProtocolError()
          return
        }
        // successful handshake returns the configuration
        log.debug("config received", data.config)
        setConfig(data.config)
        state.handshaked = true
        // log in with existing session if one exists
        if (state.session === null) {
          setState("connected")
        } else {
          doRelogin()
        }
      } else if ("disconnect" in data && data.disconnect === "connected_elsewhere") {
        // server asked us to disconnect
        log.debug("connected elsewhere, disconnecting")
        doDisconnect()
        setState("connected_elsewhere")
      } else if ("call_id" in data) {
        // find the corresponding promise
        const call = state.ongoing[data.call_id]
        if (!call) throw new Error("got response to unknown call from server")
        if (data.error) {
          // pass error to caller via promise
          call.fail(data.error, data.description)
          // if error occurs due to missing authentication, reset the session
          // TODO: this might cause problems if some kind of desync can cause
          // calls to be made while the socket is not authenticated; this could
          // cause the saved session to be lost even if it is valid
          if (data.error === "not_authenticated") {
            saveSession(null)
            setState("connected")
            setUser(null)
          }
        } else {
          // pass result to caller via promise
          call.success(data)
        }
        // call finished, forget it
        delete state.ongoing[data.call_id]
      } else {
        if ("events" in data) {
          for (const event of data.events) {
            log.debug("EVENT", event)
            onEvent(event)
          }
        }
        log.debug("UPDATE", data)
        onUpdate(data)
      }
    })
  }

  const doDisconnect = () => {
    state.closing = true
    if (state.socket !== null) state.socket.close()
    disconnected()
  }
  
  const handleProtocolError = () => {
    doDisconnect()
    setState("protocol_error")
    setTimeout(() => window.location.reload(), 2000)
  }

  const doRelogin = async () => {
    try {
      await doAuthenticate({
        id: state.session.id,
        token: state.session.token
      })
    } catch (error) {
      if (error.code !== "disconnected") {
        // relogin failed, reset session
        saveSession(null)
        setState("connected")
        setUser(null)
      }
    }
  }

  const doAuthenticate = async (params) => {
    const response = await doCall("authenticate", params, false)
    const session = {
      id: response.id,
      token: response.token,
      name: response.name
    }
    saveSession(session)
    state.authenticated = true
    setState("connected")
    setUser(session)
    // send persistent calls from previous connection
    for (const call of Object.values(state.ongoing)) {
      call.send()
    }
    return true
  }

  const doLogout = async () => {
    await doCall("log_out", {}, false)
    state.authenticated = false
    saveSession(null)
    setState("connected")
    setUser(null)
    return true
  }

  const doCall = (action, data = {}, persistent = false) => {
    return new Promise((resolve, reject) => {
      const call_id = uniqueId()
      const request = {
        action,
        call_id,
        ...data
      }
      const call = {
        call_id,
        success(result) {
          log.debug(`${call_id} <`, result)
          resolve(result)
        },
        fail(code, description) {
          log.debug(`${call_id} FAILED ${code} ${description}`)
          reject(new ApiError(code, description))
        },
        persistent,
        send() {
          state.socket.send(JSON.stringify(request))
        }
      }
      log.debug(`${call_id} > ${action}`, data)

      const canDo = action === "authenticate" ? state.handshaked : state.authenticated
      if (!canDo && !persistent) {
        call.fail("disconnected", "not connected to server")
        return
      }

      state.ongoing[call_id] = call
      if (canDo) call.send()
    })
  }

  useEffect(() => {
    doConnect()
    return () => {
      clearTimeout(state.reconnectTimeout)
      doDisconnect()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    login(name) {
      return doAuthenticate({ name })
    },
    logout() {
      return doLogout()
    },
    call(action, data = {}, persistent = false) {
      return doCall(action, data, persistent)
    }
  }), [])

  return null
})

export default GameSocket
