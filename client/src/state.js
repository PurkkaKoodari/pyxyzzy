class BlackCard {
    constructor(stateJson) {
        this.text = stateJson.text
        this.pickCount = stateJson.pick_count
        this.drawCount = stateJson.draw_count
        this.packName = stateJson.pack_name
        this.fontSizeCacheKey = `black ${this.drawCount} ${this.pickCount} ${this.text}`
    }
}

class WhiteCard {
    constructor(stateJson) {
        this.id = stateJson.id
        this.text = stateJson.text
        this.isBlank = stateJson.blank
        this.packName = stateJson.pack_name
        this.fontSizeCacheKey = `white ${this.text}`
    }
}

class Round {
    constructor(stateJson) {
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

class Player {
    constructor(stateJson) {
        this.id = stateJson.id
        this.name = stateJson.name
        this.score = stateJson.score
        this.hasPlayed = stateJson.played
    }
}

export class UserSession {
    constructor(stateJson) {
        this.id = stateJson.id
        this.name = stateJson.name
        this.token = stateJson.token
    }
}

export class GameState {
    constructor(user, stateJson) {
        this.user = user
        this.state = stateJson.game.state
        this.code = stateJson.game.code
        this.currentRound = stateJson.game.current_round && new Round(stateJson.game.current_round)
        this.players = stateJson.players.map(player => new Player(player))
        this.options = stateJson.options
        this.hand = stateJson.hand.map(card => new WhiteCard(card))
    }

    get running() {
        return this.state !== "not_started" && this.state !== "game_ended"
    }

    get host() {
        return this.players[0]
    }

    get cardCzar() {
        if (!this.currentRound)
            throw new Error("game is not running")
        return this.player(this.currentRound.cardCzarId)
    }

    player(id) {
        return this.players.find(player => player.id === id)
    }

    get roundId() {
        return this.currentRound && this.currentRound.id
    }

    get shouldPlayWhiteCards() {
        return this.state === "playing" && this.currentRound.whiteCards === null && this.hand.length > 0
    }

    get shouldJudge() {
        return this.state === "judging" && this.cardCzar.id === this.user.id
    }
}
