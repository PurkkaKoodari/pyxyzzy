import {createContext} from "react"
import {UserSession} from "./state"
import GameSocket from "./GameSocket"
import {ConfigRoot} from "./api"

export const ConfigContext = createContext<ConfigRoot | null>(null)
export const ConnectionContext = createContext<GameSocket | null>(null)
export const UserContext = createContext<UserSession | null>(null)
