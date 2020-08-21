import {GameStateEnum} from "./state"

export interface ConfigIntLimits {
  min: number
  max: number
}

export interface ConfigIntOptions extends ConfigIntLimits{
  default: number
}

export interface ConfigGameCode {
  length: number
  characters: string
}

export interface ConfigGameTitle {
  default: string
  max_length: number
}

export interface ConfigGamePassword {
  length: ConfigIntOptions
  characters: string
}

export interface ConfigGamePublicity {
  default: boolean
  allowed: boolean
  required: boolean
}

export interface ConfigGameBlankCards {
  count: ConfigIntOptions
  max_length: number
}

export interface ConfigGame {
  code: ConfigGameCode
  title: ConfigGameTitle
  password: ConfigGamePassword
  public: ConfigGamePublicity

  think_time: ConfigIntOptions
  round_end_time: ConfigIntOptions
  idle_rounds: ConfigIntOptions

  blank_cards: ConfigGameBlankCards
  player_limit: ConfigIntOptions
  point_limit: ConfigIntOptions

  hand_size: number
}

export interface ConfigUsersUsername {
  length: ConfigIntLimits
  characters: string
}

export interface ConfigUsers {
  username: ConfigUsersUsername
}

export interface ConfigChat {
  max_length: number
}

export interface ConfigCardPack {
  id: string
  name: string
  black_cards: number
  white_cards: number
}

export interface ConfigRoot {
  game: ConfigGame
  users: ConfigUsers
  chat: ConfigChat
  card_packs: ConfigCardPack[]
}

export interface AuthenticateResponse {
  id: string
  token: string
  name: string
  in_game: boolean
}

export interface GameListGame {
  code: string
  title: string
  players: number
  player_limit: number
  passworded: boolean
}

export interface GameListResponse {
  games: GameListGame[]
}

export interface UpdatePlayer {
  id: string
  name: string
  score: number
  playing: boolean
}

export interface UpdateRound {
  id: string
  black_card: UpdateBlackCard
  white_cards: UpdateWhiteCard[][] | null
  card_czar: string
  winner: {
    player: string
    cards: string
  } | null
}

export interface UpdateOptions {
  game_title: string
  public: boolean
  think_time: number
  round_end_time: number
  idle_rounds: number
  blank_cards: number
  player_limit: number
  point_limit: number
  password: string
  card_packs: string[]
  [key: string]: string | boolean | number | string[]
}

export interface UpdateWhiteCard {
  id: string
  text: string | null
  blank: boolean
  pack_name: string | null
}

export interface UpdateBlackCard {
  text: string
  pick_count: number
  draw_count: number
  pack_name: string | null
}

export interface UpdateRoot {
  game: {
    state: GameStateEnum
    code: string
    current_round: UpdateRound | null
  }
  players: UpdatePlayer[]
  hand: UpdateWhiteCard[]
  options: UpdateOptions
}
