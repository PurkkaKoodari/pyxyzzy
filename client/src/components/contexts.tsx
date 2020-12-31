import {createContext} from "react"
import {AppState, GameState, UserSession} from "../state"
import {ConfigRoot} from "../api"

export const ConfigContext = createContext<ConfigRoot | null>(null)
export const AppStateContext = createContext<AppState | null>(null)
export const UserContext = createContext<UserSession | null>(null)
export const GameContext = createContext<GameState | null>(null)
export const ActingContext = createContext<boolean>(false)
export const ChatContext = createContext<boolean>(false)
