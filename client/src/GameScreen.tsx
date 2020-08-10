import React, {Component} from "react"
import "./GameScreen.scss"
import {range, unknownError} from "./utils"
import {ConnectionContext, EventContext, UserContext} from "./contexts"
import GameOptions from "./GameOptions"
import {BlackCardView, WhiteCardView, WhiteCardGroup, WhiteCardPlaceholder} from "./cards"
import {GameState, UserSession, WhiteCard} from "./state"
import GameSocket from "./GameSocket"
import {GameEventHandler} from "./events"

interface CardViewProps {
  game: GameState
  chosenWhites: (WhiteCard | null)[]
  selectedWhitePos: number | null
  playing: boolean
  unselectCard(pos: number): void
  selectPos(pos: number): void
  confirmPlay(): void
  confirmJudge(): void
}

const CardView = ({ game, chosenWhites, selectedWhitePos, playing, unselectCard, selectPos, confirmPlay, confirmJudge }: CardViewProps) => {
  let blackCard = null, whiteCards = null
  if (game.currentRound) {
    blackCard = <BlackCardView card={game.currentRound.blackCard} />

    if ((game.state === "judging" || game.state === "round_ended") && game.currentRound.whiteCards) {
      whiteCards = game.currentRound.whiteCards.map((group: WhiteCard[], pos: number) => {
        const won = game.state === "round_ended" && game.currentRound!.winningCardsId === group[0].id
        const selected = selectedWhitePos === pos
        const actions = selected ? (
            <button type="button" disabled={playing} onClick={() => confirmJudge()}>Confirm selection</button>
        ) : null
        return (
          <WhiteCardGroup
              key={group[0].id}
              cards={group.map(card => <WhiteCardView key={card.id} card={card}/>)}
              active={won || selected}
              onClick={() => game.shouldJudge && !playing && selectPos(pos)}
              actions={actions} />
        )
      })
    } else if (game.state === "playing" && (game.shouldPlayWhiteCards || game.currentRound.whiteCards)) {
      const cards = game.currentRound.whiteCards ? game.currentRound.whiteCards[0] : chosenWhites
      const placeholders = range(game.currentRound.pickCount).map(pos => {
        if (cards[pos] !== null) {
          return (
            <WhiteCardView
                key={cards[pos]!.id}
                card={cards[pos]!}
                onClick={() => game.shouldPlayWhiteCards && !playing && unselectCard(pos)} />
          )
        } else {
          return (
            <WhiteCardPlaceholder
                key={pos}
                active={selectedWhitePos === pos}
                onClick={() => selectPos(pos)}
                text="(play a card)" />
          )
        }
      })
      const allSelected = chosenWhites.every(card => card !== null)
      const actions = game.shouldPlayWhiteCards ? (
          <button type="button" onClick={() => confirmPlay()} disabled={playing || !allSelected}>
            {game.currentRound.pickCount > 1 ? "Confirm selections" : "Confirm selection"}
          </button>
      ) : null
      whiteCards = <WhiteCardGroup cards={placeholders} actions={actions} />
    }
  }
  return (
    <div className="cards table">
      {blackCard}
      {whiteCards}
    </div>
  )
}

interface HandViewProps {
  game: GameState
  chosenWhites: (WhiteCard | null)[]
  playing: boolean
  selectCard: (card: WhiteCard) => void
}

const HandView = ({ game, chosenWhites, playing, selectCard }: HandViewProps) => {
  if (!game.shouldPlayWhiteCards)
    return null

  const cards = game.hand.map((card, pos) => {
    const picked = chosenWhites.some(chosen => chosen && chosen.id === card.id)
    return (
      <WhiteCardView
          key={card.id}
          card={card}
          picked={picked}
          onClick={() => !playing && selectCard(card)} />
    )
  })
  return (
    <div className="cards hand">{cards}</div>
  )
}

type GameScreenProps = {
  connection: GameSocket
  eventHandler: GameEventHandler
  user: UserSession
  game: GameState
}

type GameScreenState = {
  currentRoundId: string | null
  currentGameState: string | null
  chosenWhites: (WhiteCard | null)[] | null
  selectedWhitePos: number | null
  playing: boolean
}

class GameScreen extends Component<GameScreenProps, GameScreenState> {
  state: GameScreenState = {
    currentRoundId: null,
    currentGameState: null,
    chosenWhites: null,
    selectedWhitePos: null,
    playing: false,
  }

  static getDerivedStateFromProps(props: GameScreenProps, state: GameScreenState) {
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
        switch (error.code) {
          case "too_few_players":
            this.props.eventHandler.error("The game cannot start because there are too few players.")
            break
          case "too_few_black_cards":
            this.props.eventHandler.error("The game cannot start because there are no black cards in the selected card packs.")
            break
          case "too_few_white_cards":
            this.props.eventHandler.error("The game cannot start because there are too few white cards in the selected card packs for this many players.")
            break
          default:
            unknownError(error)
            break
        }
      }
    }

    const unselectCard = (posToClear: number) => {
      // unselect the card at the position
      const newChosenWhites = [...this.state.chosenWhites!]
      newChosenWhites[posToClear] = null
      this.setState({
        chosenWhites: newChosenWhites,
        // move focus to the cleared position
        selectedWhitePos: posToClear,
      })
    }

    const selectCard = (card: WhiteCard) => {
      // can't reselect a card
      if (this.state.chosenWhites!.some(chosen => chosen && chosen.id === card.id))
        return
      // ensure a valid slot
      if (this.state.selectedWhitePos === null || !game.currentRound || this.state.selectedWhitePos >= game.currentRound.pickCount)
        return
      // put the card in place
      const newChosenWhites = [...this.state.chosenWhites!]
      newChosenWhites[this.state.selectedWhitePos!] = card
      // find a free slot, if any
      const nextFreePos = range(this.state.selectedWhitePos + 1, game.currentRound.pickCount)
          .concat(range(0, this.state.selectedWhitePos))
          .find(pos => newChosenWhites[pos] === null)
      this.setState({
        chosenWhites: newChosenWhites,
        selectedWhitePos: nextFreePos === undefined ? null : nextFreePos,
      })
    }

    const confirmPlay = async () => {
      // ensure valid selections
      if (!game.shouldPlayWhiteCards || !this.state.chosenWhites!.every(card => card !== null))
        return
      // disable UI before call
      this.setState({ playing: true })
      try {
        // TODO: support for blanks
        await connection.call("play_white", {
          round: game.roundId,
          cards: this.state.chosenWhites!.map(card => ({
            id: card!.id,
          })),
        })
      } catch (error) {
        unknownError(error)
      } finally {
        // re-enable UI
        this.setState({ playing: false })
      }
    }

    const confirmJudge = async () => {
      // ensure a valid state
      if (!game.shouldJudge || this.state.selectedWhitePos === null || this.state.selectedWhitePos >= game.currentRound!.whiteCards!.length)
        return
      // disable UI before call
      this.setState({ playing: true })
      try {
        await connection.call("choose_winner", {
          round: game.roundId,
          winner: game.currentRound!.whiteCards![this.state.selectedWhitePos][0].id,
        })
      } catch (error) {
        unknownError(error)
      } finally {
        // re-enable UI
        this.setState({ playing: false })
      }
    }

    let controls = null
    if (user.id === game.host.id) {
      controls =
          <button type="button" onClick={handleStartStop}>
            {game.running ? "Stop game" : "Start game"}
          </button>
    }

    return (
        <div className={`in-game game-state-${game.state} ${game.shouldJudge ? "should-judge" : ""} ${game.shouldPlayWhiteCards ? "should-play" : ""}`}>
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
              chosenWhites={this.state.chosenWhites!}
              selectedWhitePos={this.state.selectedWhitePos}
              playing={this.state.playing}
              unselectCard={unselectCard}
              selectPos={pos => this.setState({selectedWhitePos: pos})}
              confirmPlay={confirmPlay}
              confirmJudge={confirmJudge} />
          <HandView
              game={game}
              chosenWhites={this.state.chosenWhites!}
              playing={this.state.playing}
              selectCard={selectCard} />
        </div>
    )
  }
}

export default (props: {game: GameState, chatMessages: any}) => (
  <UserContext.Consumer>
    {user => (
      <ConnectionContext.Consumer>
        {connection => (
          <EventContext.Consumer>
            {eventHandler => (
              <GameScreen user={user!} connection={connection!} eventHandler={eventHandler!} {...props} />
            )}
          </EventContext.Consumer>
        )}
      </ConnectionContext.Consumer>
    )}
  </UserContext.Consumer>
)
