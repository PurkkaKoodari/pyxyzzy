import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"

const INITIAL_RECONNECT_INTERVAL = .5
const MAX_RECONNECT_INTERVAL = 15

const SESSIONSTORAGE_KEY = "pyXyzzy.session"

const getSessionFromStorage = () => {
  try {
    const sessionJson = sessionStorage.getItem(SESSIONSTORAGE_KEY)
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

/* eslint-disable react-hooks/exhaustive-deps */

const GameSocket = forwardRef(({ url, onEvent, onUpdate, onStateChange }, ref) => {
  const handlersChanged = useRef(0)

  useEffect(() => {
    if (++handlersChanged.current > 1) {
      alert("The url or handlers for GameSocket changed. Because there seems to be no other sane way " +
        "to integrate WebSockets with React, they must not change (use useCallback). Either " +
        "useCallback was not used somewhere, or something else is very broken.")
    }
  }, [url, onEvent, onUpdate, onStateChange])

  if (typeof onEvent !== "function") throw new TypeError("onEvent must be a function")
  if (typeof onUpdate !== "function") throw new TypeError("onUpdate must be a function")
  if (typeof onStateChange !== "function") throw new TypeError("onStateChange must be a function")

  const state = useRef({
    socket: null,
    connected: false,
    authenticated: false,
    closing: false,
    reconnectTimeout: -1,
    connectAttempts: 0,
    next: 0,
    ongoing: {},
    session: false
  }).current

  if (state.session === false) state.session = getSessionFromStorage()

  const saveSession = (session) => {
    state.session = session
    sessionStorage.setItem(SESSIONSTORAGE_KEY, JSON.stringify(session))
  }

  const disconnected = () => {
    state.connected = false
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
    const ws = new WebSocket(url)
    state.socket = ws
    state.connectAttempts++

    ws.addEventListener("open", (e) => {
      state.connectAttempts = 0
      state.connected = true
      if (state.session === null) {
        onStateChange({
          connection: "connected",
          user: null
        })
      } else {
        doRelogin()
      }
    })
    ws.addEventListener("close", (e) => {
      if (state.closing) return
      disconnected()
      let delay = Math.min(MAX_RECONNECT_INTERVAL, INITIAL_RECONNECT_INTERVAL * 2 ** state.connectAttempts)
      state.reconnectTimeout = setTimeout(doConnect, delay * 1000)
      onStateChange({
        connection: state.connectAttempts > 0 ? "retrying" : "reconnecting",
        user: null,
        reconnectIn: delay
      })
    })
    ws.addEventListener("message", (e) => {
      const data = JSON.parse(e.data)
      if ("call_id" in data) {
        const call = state.ongoing[data.call_id]
        if (!call) throw new Error("got response to unknown call from server")
        if (data.error) {
          call.fail(data.error, data.description)
        } else {
          call.success(data)
        }
        delete state.ongoing[data.call_id]
      } else {
        if ("events" in data) {
          data.events.forEach(onEvent)
        }
        onUpdate(data)
      }
    })
  }

  const doDisconnect = () => {
    state.closing = true
    if (state.socket !== null) state.socket.close()
    disconnected()
  }

  const doRelogin = async () => {
    try {
      await doAuthenticate({
        id: state.session.id,
        token: state.session.token
      })
    } catch (error) {
      if (error.code !== "disconnected") {
        saveSession(null)
        onStateChange({
          connection: "connected",
          user: null
        })
      } else {
        console.error(error)
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
    onStateChange({
      connection: "connected",
      user: session
    })
    // send persistent calls from previous connection
    for (const call of Object.values(state.ongoing)) {
      call.send()
    }
    return true
  }

  const doLogout = async () => {
    await doCall("log_out", {}, false)
    state.authenticated = false
    onStateChange({
      connection: "connected",
      user: null
    })
    return true
  }

  const doCall = (action, data = {}, persistent = false) => {
    return new Promise((resolve, reject) => {
      const call_id = state.next++
      const request = {
        action,
        call_id,
        ...data
      }
      const call = {
        call_id,
        success(result) {
          resolve(result)
        },
        fail(code, description) {
          reject(new ApiError(code, description))
        },
        persistent,
        send() {
          state.socket.send(JSON.stringify(request))
        }
      }

      const canDo = action === "authenticate" ? state.connected : state.authenticated
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
