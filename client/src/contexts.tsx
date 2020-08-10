import {createContext} from "react"
import {UserSession} from "./state"
import GameSocket from "./GameSocket"
import {ConfigRoot} from "./api"
import {GameEventHandler} from "./events"

export const ConfigContext = createContext<ConfigRoot | null>(null)
export const EventContext = createContext<GameEventHandler | null>(null)
export const ConnectionContext = createContext<GameSocket | null>(null)
export const UserContext = createContext<UserSession | null>(null)
