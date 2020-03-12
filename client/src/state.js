class Game {
    constructor(stateJson) {
        this.state = stateJson.game.state
        this.code = stateJson.game.code
        this.currentRound = stateJson.game.current_round
        this.players = stateJson.players
        this.options = stateJson.options
        this.hand = stateJson.hand
    }

    get running() {
        return this.state !== "not_started" && this.state !== "game_ended"
    }
}

export default Game
