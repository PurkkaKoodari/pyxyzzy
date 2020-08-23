import {GameStateEnum} from "./state"

export interface ConfigIntLimits {
  readonly min: number
  readonly max: number
}

export interface ConfigIntOptions extends ConfigIntLimits {
  readonly default: number
}

export interface ConfigGameCode {
  readonly length: number
  readonly characters: string
}

export interface ConfigGameTitle {
  readonly default: string
  readonly max_length: number
}

export interface ConfigGamePassword {
  readonly length: ConfigIntOptions
  readonly characters: string
}

export interface ConfigGamePublicity {
  readonly default: boolean
  readonly allowed: boolean
  readonly required: boolean
}

export interface ConfigGameBlankCards {
  readonly count: ConfigIntOptions
  readonly max_length: number
}

export interface ConfigGame {
  readonly code: ConfigGameCode
  readonly title: ConfigGameTitle
  readonly password: ConfigGamePassword
  readonly public: ConfigGamePublicity

  readonly think_time: ConfigIntOptions
  readonly round_end_time: ConfigIntOptions
  readonly idle_rounds: ConfigIntOptions

  readonly blank_cards: ConfigGameBlankCards
  readonly player_limit: ConfigIntOptions
  readonly point_limit: ConfigIntOptions

  readonly hand_size: number
}

export interface ConfigUsersUsername {
  readonly length: ConfigIntLimits
  readonly characters: string
}

export interface ConfigUsers {
  readonly username: ConfigUsersUsername
}

export interface ConfigChat {
  readonly max_length: number
}

export interface ConfigCardPack {
  readonly id: string
  readonly name: string
  readonly black_cards: number
  readonly white_cards: number
}

export interface ConfigRoot {
  readonly game: ConfigGame
  readonly users: ConfigUsers
  readonly chat: ConfigChat
  readonly card_packs: readonly ConfigCardPack[]
}

export interface AuthenticateResponse {
  readonly id: string
  readonly token: string
  readonly name: string
  readonly in_game: boolean
}

export interface GameListGame {
  readonly code: string
  readonly title: string
  readonly players: number
  readonly player_limit: number
  readonly passworded: boolean
}

export interface GameListResponse {
  readonly games: readonly GameListGame[]
}

export interface UpdatePlayer {
  readonly id: string
  readonly name: string
  readonly score: number
  readonly playing: boolean
}

export interface UpdateRound {
  readonly id: string
  readonly black_card: UpdateBlackCard
  readonly white_cards: readonly UpdateWhiteCard[][] | null
  readonly card_czar: string
  readonly winner: {
    readonly player: string
    readonly cards: string
  } | null
}

export interface UpdateOptions {
  readonly game_title: string
  readonly public: boolean
  readonly think_time: number
  readonly round_end_time: number
  readonly idle_rounds: number
  readonly blank_cards: number
  readonly player_limit: number
  readonly point_limit: number
  readonly password: string
  readonly card_packs: string[]
  readonly [key: string]: string | boolean | number | string[]
}

export interface UpdateWhiteCard {
  readonly id: string
  readonly text: string | null
  readonly blank: boolean
  readonly pack_name: string | null
}

export interface UpdateBlackCard {
  readonly text: string
  readonly pick_count: number
  readonly draw_count: number
  readonly pack_name: string | null
}

export interface UpdateGame {
  readonly state: GameStateEnum
  readonly code: string
  readonly current_round: UpdateRound | null
}

export interface UpdateRoot {
  readonly game: UpdateGame
  readonly players: readonly UpdatePlayer[]
  readonly hand: readonly UpdateWhiteCard[]
  readonly options: UpdateOptions
}
