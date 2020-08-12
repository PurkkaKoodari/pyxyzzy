import {
    AuthenticateResponse,
    UpdateBlackCard, UpdateOptions,
    UpdatePlayer,
    UpdateRoot,
    UpdateRound,
    UpdateWhiteCard,
} from "./api"

export interface AbstractCard {
    text: string
    packName: string | null
    fontSizeCacheKey: string
}

export class BlackCard implements AbstractCard {
    text: string
    packName: string | null
    pickCount: number
    drawCount: number
    fontSizeCacheKey: string

    constructor(stateJson: UpdateBlackCard) {
        this.text = stateJson.text
        this.pickCount = stateJson.pick_count
        this.drawCount = stateJson.draw_count
        this.packName = stateJson.pack_name
        this.fontSizeCacheKey = `black ${this.drawCount} ${this.pickCount} ${this.text}`
    }
}

export class WhiteCard {
    id: string
    text: string
    isBlank: boolean
    packName: string | null
    fontSizeCacheKey: string

    constructor(stateJson: UpdateWhiteCard) {
        this.id = stateJson.id
        this.text = stateJson.text || ""
        this.isBlank = stateJson.blank
        this.packName = stateJson.pack_name
        this.fontSizeCacheKey = `white ${this.text}`
    }
}

export class Round {
    id: string
    cardCzarId: string
    blackCard: BlackCard
    whiteCards: WhiteCard[][] | null
    winningPlayerId: string | null
    winningCardsId: string | null

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
    id: string
    name: string
    score: number
    isThinking: boolean

    constructor(stateJson: UpdatePlayer) {
        this.id = stateJson.id
        this.name = stateJson.name
        this.score = stateJson.score
        this.isThinking = stateJson.playing
    }
}

export class UserSession {
    id: string
    name: string
    token: string

    constructor(stateJson: AuthenticateResponse) {
        this.id = stateJson.id
        this.name = stateJson.name
        this.token = stateJson.token
    }
}

export class GameState {
    user: UserSession
    state: string
    code: string
    currentRound: Round | null
    players: Player[]
    options: UpdateOptions
    hand: WhiteCard[]

    constructor(user: UserSession, stateJson: UpdateRoot) {
        this.user = user
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

    get host(): Player {
        return this.players[0]
    }

    get cardCzar(): Player {
        if (!this.currentRound)
            throw new Error("game is not running")
        return this.player(this.currentRound.cardCzarId)
    }

    get roundWinner(): Player | null {
        if (!this.currentRound)
            throw new Error("game is not running")
        return this.currentRound.winningPlayerId ? this.player(this.currentRound.winningPlayerId) : null
    }

    player(id: string): Player {
        const player = this.players.find(player => player.id === id)
        if (!player)
            throw new Error("player not found")
        return player
    }

    get roundId(): string | null {
        return this.currentRound && this.currentRound.id
    }

    get shouldPlayWhiteCards() {
        return this.state === "playing" && this.cardCzar.id !== this.user.id && this.currentRound!.whiteCards === null && this.hand.length > 0
    }

    get shouldJudge() {
        return this.state === "judging" && this.cardCzar.id === this.user.id
    }
}
