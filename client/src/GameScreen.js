import React, {Component, useContext} from "react"
import "./GameScreen.scss"
import {range, unknownError} from "./utils"
import {ConnectionContext, UserContext} from "./contexts"
import GameOptions from "./GameOptions"
import {BlackCard, WhiteCard, WhiteCardGroup, WhiteCardPlaceholder} from "./cards"

const CardView = ({ game, chosenWhites, selectedWhitePos, unselectCard, setSelectedWhitePos }) => {
  const user = useContext(UserContext)

  let blackCard = null, whiteCards = null
  if (game.currentRound) {
    blackCard = <BlackCard card={game.currentRound.blackCard} />

    if ((game.state === "judging" || game.state === "round_ended") && game.currentRound.whiteCards) {
      whiteCards = game.currentRound.whiteCards.map((group, pos) => {
        const won = game.state === "round_ended" && game.currentRound.winningCardsId === group[0].id
        const selected = selectedWhitePos === pos
        return (
          <WhiteCardGroup
              key={group[0].id}
              cards={group.map(card => <WhiteCard key={card.id} card={card}/>)}
              active={won || selected}
              onClick={() => game.shouldJudge(user.id) && setSelectedWhitePos(pos)} />
        )
      })
    } else if (game.state === "playing" && (game.shouldPlayWhiteCards || game.currentRound.whiteCards)) {
      const cards = game.currentRound.whiteCards ? game.currentRound.whiteCards[0] : chosenWhites
      const placeholders = range(game.currentRound.pickCount).map(pos => {
        if (cards[pos] !== null) {
          return (
            <WhiteCard
                key={cards[pos].id}
                card={cards[pos]}
                onClick={() => game.shouldPlayWhiteCards && unselectCard(pos)} />
          )
        } else {
          return (
            <WhiteCardPlaceholder
                key={pos}
                active={selectedWhitePos === pos}
                onClick={() => setSelectedWhitePos(pos)}
                text="(play a card)" />
          )
        }
      })
      whiteCards = <WhiteCardGroup cards={placeholders} />
    }
  }
  return (
    <div className="cards table">
      {blackCard}
      {whiteCards}
    </div>
  )
}

const HandView = ({ game, chosenWhites, selectCard }) => {
  if (!game.shouldPlayWhiteCards)
    return null

  const cards = game.hand.map((card, pos) => {
    const picked = chosenWhites.some(chosen => chosen && chosen.id === card.id)
    return (
      <WhiteCard
          key={card.id}
          card={card}
          picked={picked}
          onClick={() => selectCard(card.id)} />
    )
  })
  return (
    <div className="cards hand">{cards}</div>
  )
}

class GameScreen extends Component {
  state = {
    currentRoundId: null,
    currentGameState: null,
    chosenWhites: null,
    selectedWhitePos: null,
  }

  static getDerivedStateFromProps(props, state) {
    let newState = {}
    // clear chosen white cards if not playing any
    if (props.game.roundId !== state.currentRoundId || !props.game.shouldPlayWhiteCards) {
      newState = {
        ...newState,
        chosenWhites: props.game.currentRound && Array(props.game.currentRound.pickCount).fill(null),
        currentRoundId: props.game.roundId,
      }
    }
    if (props.game.state !== state.currentGameState) {
      newState = {
        ...newState,
        selectedWhitePos: props.game.state === "playing" ? 0 : null,
        currentGameState: props.game.state,
      }
    }
    return newState
  }

  render() {
    const {game, connection, user} = this.props

    const handleLeave = async () => {
      try {
        await connection.call("leave_game")
      } catch (error) {
        unknownError(error)
      }
    }

    const handleLogout = async () => {
      try {
        await connection.logout()
      } catch (error) {
        unknownError(error)
      }
    }

    const handleStartStop = async () => {
      try {
        await connection.call(game.running ? "stop_game" : "start_game")
      } catch (error) {
        unknownError(error)
      }
    }

    const unselectCard = (posToClear) => {
      // unselect the card at the position
      const newChosenWhites = [...this.state.chosenWhites]
      newChosenWhites[posToClear] = null
      this.setState({
        chosenWhites: newChosenWhites,
        // move focus to the cleared position
        selectedWhitePos: posToClear,
      })
    }

    const selectCard = (cardId) => {
      // can't reselect a card
      if (this.state.chosenWhites.some(chosen => chosen && chosen.id === cardId))
        return
      // ensure a valid slot
      if (this.state.selectedWhitePos === null || !game.currentRound || this.state.selectedWhitePos >= game.currentRound.pickCount)
        return
      // put the card in place
      const newChosenWhites = [...this.state.chosenWhites]
      newChosenWhites[this.state.selectedWhitePos] = game.hand.find(card => card.id === cardId)
      // find a free slot, if any
      const nextFreePos = range(this.state.selectedWhitePos + 1, game.currentRound.pickCount)
          .concat(range(0, this.state.selectedWhitePos))
          .find(pos => newChosenWhites[pos] === null)
      this.setState({
        chosenWhites: newChosenWhites,
        selectedWhitePos: nextFreePos === undefined ? null : nextFreePos,
      })
    }

    let controls = null
    if (user.id === game.host.id) {
      controls =
          <button type="button" onClick={handleStartStop}>
            {game.running ? "Stop game" : "Start game"}
          </button>
    }

    const isCzar = game.running && game.cardCzar.id === user.id
    const isHost = game.players && game.host.id === user.id

    return (
        <div className={`in-game game-state-${game.state} ${isCzar ? "is-czar" : ""} ${isHost ? "is-host" : ""} ${game.shouldPlayWhiteCards ? "play-white" : ""}`}>
          <div className="nav">
            <div className="game-controls">
              {controls}
            </div>
            <div className="game-info">
              <div className="game-code">Game <b>{game.code}</b></div>
              <button type="button" onClick={handleLeave}>Leave game</button>
            </div>
            <div className="user-info">
              <div className="user-name">Logged in as <b>{user.name}</b></div>
              <button type="button" onClick={handleLogout}>Log out</button>
            </div>
          </div>
          <GameOptions game={game}/>
          <CardView
              game={game}
              chosenWhites={this.state.chosenWhites}
              unselectCard={unselectCard}
              selectedWhitePos={this.state.selectedWhitePos}
              setSelectedWhitePos={(selectedWhitePos) => this.setState({selectedWhitePos})} />
          <HandView
              game={game}
              chosenWhites={this.state.chosenWhites}
              selectCard={selectCard} />
        </div>
    )
  }
}

export default (props) => (
  <UserContext.Consumer>
    {user => (
      <ConnectionContext.Consumer>
        {connection => (
          <GameScreen user={user} connection={connection} {...props} />
        )}
      </ConnectionContext.Consumer>
    )}
  </UserContext.Consumer>
)
