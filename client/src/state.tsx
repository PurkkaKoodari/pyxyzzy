import {
  AuthenticateResponse, GameListResponse,
  UpdateBlackCard,
  UpdateOptions,
  UpdatePlayer,
  UpdateRoot,
  UpdateRound,
  UpdateWhiteCard,
} from "./api"
import {englishList} from "./utils"
import log from "loglevel"
import MessageHandler from "./MessageHandler"
import GameSocket from "./GameSocket"

export interface AbstractCard {
  readonly text: string
  readonly packName: string | null
  readonly fontSizeCacheKey: string
}

export class BlackCard implements AbstractCard {
  readonly text: string
  readonly packName: string | null
  readonly pickCount: number
  readonly drawCount: number
  readonly fontSizeCacheKey: string

  constructor(stateJson: UpdateBlackCard) {
    this.text = stateJson.text
    this.pickCount = stateJson.pick_count
    this.drawCount = stateJson.draw_count
    this.packName = stateJson.pack_name
    this.fontSizeCacheKey = `black ${this.drawCount} ${this.pickCount} ${this.text}`
  }
}

export class WhiteCard {
  readonly id: string
  readonly text: string
  readonly isBlank: boolean
  readonly packName: string | null
  readonly fontSizeCacheKey: string

  constructor(stateJson: UpdateWhiteCard) {
    this.id = stateJson.id
    this.text = stateJson.text || ""
    this.isBlank = stateJson.blank
    this.packName = stateJson.pack_name
    this.fontSizeCacheKey = `white ${this.text}`
  }
}

export class Round {
  readonly id: string
  readonly cardCzarId: string
  readonly blackCard: Readonly<BlackCard>
  readonly whiteCards: Readonly<WhiteCard[][]> | null
  readonly winningPlayerId: string | null
  readonly winningCardsId: string | null

  constructor(stateJson: UpdateRound) {
    this.id = stateJson.id
    this.cardCzarId = stateJson.card_czar
    this.blackCard = new BlackCard(stateJson.black_card)
    this.whiteCards = stateJson.white_cards && stateJson.white_cards.map(group => group.map(card => new WhiteCard(card)))
    this.winningPlayerId = stateJson.winner && stateJson.winner.player
    this.winningCardsId = stateJson.winner && stateJson.winner.cards
  }

  get pickCount() {
    return this.blackCard.pickCount
  }
}

export class Player {
  readonly id: string
  readonly name: string
  readonly score: number
  readonly isThinking: boolean

  constructor(stateJson: UpdatePlayer) {
    this.id = stateJson.id
    this.name = stateJson.name
    this.score = stateJson.score
    this.isThinking = stateJson.playing
  }
}

export class UserSession {
  readonly id: string
  readonly name: string
  readonly token: string

  constructor(stateJson: AuthenticateResponse) {
    this.id = stateJson.id
    this.name = stateJson.name
    this.token = stateJson.token
  }
}

export type GameStateEnum = "not_started" | "playing" | "judging" | "round_ended" | "game_ended"

export class GameState {
  private readonly appState: AppState

  readonly state: GameStateEnum
  readonly code: string
  readonly currentRound: Readonly<Round> | null
  readonly players: Readonly<Player[]>
  readonly options: Readonly<UpdateOptions>
  readonly hand: Readonly<WhiteCard[]>

  constructor(app: AppState, stateJson: UpdateRoot) {
    this.appState = app
    this.state = stateJson.game.state
    this.code = stateJson.game.code
    this.currentRound = stateJson.game.current_round && new Round(stateJson.game.current_round)
    this.players = stateJson.players.map(player => new Player(player))
    this.options = stateJson.options
    this.hand = stateJson.hand.map(card => new WhiteCard(card))
  }

  get running(): boolean {
    return this.state !== "not_started" && this.state !== "game_ended"
  }

  get currentRoundChecked(): Readonly<Round> {
    if (!this.currentRound)
      throw new Error("game is not running")
    return this.currentRound
  }

  get host(): Player {
    return this.players[0]
  }

  get isHost(): boolean {
    return this.appState.loggedInUser.id === this.host.id
  }

  get cardCzar(): Player {
    return this.playerById(this.currentRoundChecked.cardCzarId)
  }

  get isCardCzar(): boolean {
    return this.appState.loggedInUser.id === this.cardCzar.id
  }

  get roundWinner(): Player | null {
    return this.currentRoundChecked.winningPlayerId ? this.playerById(this.currentRoundChecked.winningPlayerId) : null
  }

  playerById(id: string): Player {
    const player = this.players.find(player => player.id === id)
    // TODO: see if this can be hit e.g. if the round winner leaves
    if (!player)
      throw new Error("player not found")
    return player
  }

  get roundId(): string | null {
    return this.currentRound && this.currentRound.id
  }

  get shouldPlayWhiteCards() {
    return this.state === "playing" && !this.isCardCzar && this.currentRound!.whiteCards === null && this.hand.length > 0
  }

  get shouldJudge() {
    return this.state === "judging" && this.isCardCzar
  }
}

export class AppState {
  readonly connection: GameSocket
  readonly messageHandler: MessageHandler
  private user: UserSession | null = null
  private game: GameState | null = null
  private isActing: boolean = false

  onUserUpdated: (user: UserSession | null) => void = () => {}
  onGameStateUpdated: (game: GameState | null) => void = () => {}
  onActingChanged: (acting: boolean) => void = () => {}

  constructor() {
    this.connection = new GameSocket(this)
    this.messageHandler = new MessageHandler()
  }

  get loggedInUser(): UserSession {
    if (!this.user)
      throw new Error("not logged in")
    return this.user
  }

  private get acting() {
    return this.isActing
  }

  private set acting(acting: boolean) {
    this.isActing = acting
    this.onActingChanged(acting)
  }

  async act<R>(action: (() => Promise<R>) | string, params?: any, persistent?: boolean): Promise<R> {
    if (this.acting) {
      log.warn("Canceling", action, "because another action is already ongoing")
      throw new Error("another action is already ongoing")
    }
    this.acting = true
    try {
      if (typeof action === "string")
        return await this.connection.call(action, params, persistent)
      else
        return await action()
    } finally {
      this.acting = false
    }
  }

  async login(name: string) {
    await this.connection.login(name)
  }

  async logout() {
    await this.act(() => this.connection.logout())
  }

  async gameList(): Promise<GameListResponse> {
    return await this.act<GameListResponse>("game_list")
  }

  async createGame() {
    return await this.act("create_game", {}, true)
  }

  async joinGame(code: string, password: string = "") {
    await this.act("join_game", {code, password}, true)
  }

  async leaveGame() {
    await this.act("leave_game", {}, true)
  }

  async startGame() {
    await this.act("start_game", {}, true)
  }

  async stopGame() {
    await this.act("stop_game", {}, true)
  }

  async setGameOptions(options: Partial<UpdateOptions>) {
    await this.connection.call("game_options", options, true)
  }

  async playWhiteCards(cards: WhiteCard[]) {
    if (!this.game)
      throw new Error("not in game")
    await this.act("play_white", {
      round: this.game.roundId,
      cards: cards.map(card => {
        if (card.isBlank) {
          return {
            id: card.id,
            text: card.text,
          }
        }
        return {
          id: card.id,
        }
      })
    }, true)
  }

  async chooseWinner(winningCard: WhiteCard) {
    if (!this.game)
      throw new Error("not in game")
    await this.act("choose_winner", {
      round: this.game.roundId,
      winner: winningCard.id,
    }, true)
  }

  updateSession(session: UserSession | null) {
    this.user = session
    if (!session)
      this.acting = false
    this.onUserUpdated(this.user)
  }

  updateGameState(update: UpdateRoot | null) {
    this.game = update && new GameState(this, update)
    this.onGameStateUpdated(this.game)
  }

  handleEvent(event: any) {
    switch (event.type) {
      case "card_czar_idle":
        this.messageHandler.warning(`${event.player.name} (the Card Czar) was idle for too long. The white ` +
            `cards played this round will be returned to hands.`)
        break
      case "players_idle":
        const names = englishList(event.players.map((player: any) => player.name), ["was", "were"])
        this.messageHandler.warning(`${names} idle for too long and ` +
            `${event.players.length === 1 ? "was" : "were"} skipped this round.`)
        break
      case "too_few_cards_played":
        this.messageHandler.warning("Too many players were idle this round. The white cards played this " +
            "round will be returned to hands.")
        break
      case "player_join":
        this.messageHandler.info(`${event.player.name} joined the game.`)
        break
      case "player_leave":
        const you = event.player.id === this.loggedInUser.id
        switch (event.reason) {
          case "disconnect":
            if (!you)
              this.messageHandler.info(`${event.player.name} disconnected.`)
            break
          case "host_kick":
            if (you)
              this.messageHandler.error("You were kicked from the game.", false)
            else
              this.messageHandler.info(`${event.player.name} was kicked from the game.`)
            break
          case "idle":
            if (you)
              this.messageHandler.error("You were kicked from the game for being idle for too many rounds.", false)
            else
              this.messageHandler.warning(`${event.player.name} was kicked from the game for being idle for ` +
                  `too many rounds.`)
            break
          case "leave":
          default:
            if (!you) this.messageHandler.info(`${event.player.name} left the game.`)
            break
        }
        break
      case "too_few_players":
        this.messageHandler.error("The game was stopped because too few players remained.")
        break
      case "card_czar_leave":
        this.messageHandler.error(`${event.player.name} (the Card Czar) has left the game. The white cards played ` +
            `this round will be returned to hands.`)
        break
      case "host_leave":
        this.messageHandler.info(`${event.new_host.name} is now the host.`)
        break
      case "chat_message":
        this.messageHandler.log(event.text)
        break
      default:
        log.error("unknown event", event)
        break
    }
  }
}
