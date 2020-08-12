import React, {Component, useContext, useEffect, useState} from "react"
import "./GameScreen.scss"
import {range, unknownError} from "./utils"
import {ConfigContext, ConnectionContext, EventContext, UserContext} from "./contexts"
import GameOptions from "./GameOptions"
import {BlackCardView, WhiteCardGroup, WhiteCardPlaceholder, WhiteCardView} from "./cards"
import {GameState, UserSession, WhiteCard} from "./state"
import GameSocket from "./GameSocket"
import {GameEventHandler} from "./events"

// minimum scale to render cards at. if this doesn't fit, well, you're screwed
const MINIMUM_CARD_SCALE = 0.7

interface InstructionsViewProps {
  game: GameState
  chosenWhites: (WhiteCard | null)[]
  selectedWhitePos: number | null
}

const InstructionsView = ({ game, chosenWhites, selectedWhitePos }: InstructionsViewProps) => {
  let action = null
  if (game.shouldPlayWhiteCards) {
    const toPlay = chosenWhites.filter(card => card === null).length
    if (toPlay) {
      action = <>Play {toPlay} {toPlay === chosenWhites.length ? "" : "more "}card{toPlay > 1 ? "s" : ""}.</>
    } else {
      action = <>Confirm your selection{game.currentRound!.pickCount > 1 ? "s" : ""}. Click a card to unselect.</>
    }
  } else if (game.state === "playing") {
    action = <>Waiting for the other players to play&hellip;</>
  } else if (game.shouldJudge) {
    if (selectedWhitePos === null) {
      action = <>Choose a winner.</>
    } else {
      action = <>Confirm your selection.</>
    }
  } else if (game.state === "judging") {
    action = <>Waiting for {game.cardCzar.name} to choose a winner&hellip;</>
  } else if (game.state === "round_ended") {
    if (game.roundWinner) {
      const name = game.roundWinner.id === game.user.id ? "You" : game.roundWinner.name
      action = <>{name} won the round. Next round starts in {game.options.round_end_time} seconds.</>
    } else {
      action = <>The round has been cancelled. Next round starts in {game.options.round_end_time} seconds.</>
    }
  }

  return action && <h3 className="instructions">{action}</h3>
}

interface TableViewProps {
  game: GameState
  chosenWhites: (WhiteCard | null)[]
  selectedWhitePos: number | null
  playing: boolean
  windowWidth: number
  unselectCard(pos: number): void
  selectPos(pos: number): void
  confirmPlay(): void
  confirmJudge(): void
}

const TableView = ({ game, chosenWhites, selectedWhitePos, playing, windowWidth, unselectCard, selectPos, confirmPlay, confirmJudge }: TableViewProps) => {
  const config = useContext(ConfigContext)!

  if (!game.currentRound)
    return null

  const table = game.currentRound.whiteCards
  const groupSize = game.currentRound.pickCount

  // responsive scaling algorithm for cards

  // first, compute the actual number of card groups on the table
  let groupsOnTable = config.game.player_limit.max
  if (game.state === "judging" || game.state === "round_ended") {
    groupsOnTable = table === null ? 0 : table!.length
  } else if (game.state === "playing") {
    groupsOnTable = 1
  }

  // next, figure out how many things we need to wrap and how much horizontal space we have for white cards
  // multi-card groups have an extra 5px right border
  const groupWidth = 5 + 205 * groupSize + (groupSize > 1 ? 5 : 0)
  // keep the black card next to the white cards, except if too few cards would fit
  const minDesiredGroups = Math.min(groupsOnTable, Math.max(1, Math.floor(4 / groupSize)))
  const wrapBlackCard = windowWidth < (220 + minDesiredGroups * groupWidth) * MINIMUM_CARD_SCALE
  // if no groups fit on the screen even at minimum scale, make it look nicer by wrapping the groups as well
  const wrapGroups = windowWidth < (10 + groupWidth) * MINIMUM_CARD_SCALE
  // consume space for the black card if unwrapped or if the groups are wrapped
  const widthOffset = !wrapBlackCard || wrapGroups ? 220 : 10

  let scale = MINIMUM_CARD_SCALE
  for (let groupsPerRow = 0; groupsPerRow <= groupsOnTable; groupsPerRow++) {
    const unscaledRowWidth = widthOffset + groupWidth * groupsPerRow
    const thisScale = Math.min(1, windowWidth / unscaledRowWidth)
    // use this scale unless the cards are now too small
    if (thisScale < MINIMUM_CARD_SCALE) break
    scale = thisScale
  }

  let whiteCards = null

  if ((game.state === "judging" || game.state === "round_ended") && table !== null) {
    whiteCards = table!.map((group: WhiteCard[], pos: number) => {
      const won = game.state === "round_ended" && game.currentRound!.winningCardsId === group[0].id
      const selected = selectedWhitePos === pos
      const actions = selected ? (
          <button type="button" disabled={playing} onClick={() => confirmJudge()}>Confirm selection</button>
      ) : null
      return (
        <WhiteCardGroup
            key={group[0].id}
            cards={group.map(card => <WhiteCardView key={card.id} card={card} scale={scale} />)}
            active={won || selected}
            actions={actions}
            scale={scale}
            onClick={() => game.shouldJudge && !playing && selectPos(pos)} />
      )
    })
  } else if (game.state === "playing" && (game.shouldPlayWhiteCards || table !== null)) {
    const cards = table !== null ? table[0] : chosenWhites
    const placeholders = range(groupSize).map(pos => {
      if (cards[pos] !== null) {
        return (
          <WhiteCardView
              key={cards[pos]!.id}
              card={cards[pos]!}
              scale={scale}
              onClick={() => game.shouldPlayWhiteCards && !playing && unselectCard(pos)} />
        )
      } else {
        return (
          <WhiteCardPlaceholder
              text="(play a card)"
              key={pos}
              active={selectedWhitePos === pos}
              scale={scale}
              onClick={() => selectPos(pos)} />
        )
      }
    })
    const allSelected = chosenWhites.every(card => card !== null)
    const actions = game.shouldPlayWhiteCards ? (
        <button type="button" onClick={() => confirmPlay()} disabled={playing || !allSelected}>
          {groupSize > 1 ? "Confirm selections" : "Confirm selection"}
        </button>
    ) : null
    whiteCards = <WhiteCardGroup cards={placeholders} actions={actions} scale={scale} />
  }

  return (
      <div className={`table ${wrapBlackCard ? "wrap-black" : ""} ${wrapGroups ? "wrap-groups" : ""}`}>
        <BlackCardView card={game.currentRound.blackCard} scale={scale} />
        <div className="cards">{whiteCards}</div>
      </div>
  )
}

interface HandViewProps {
  game: GameState
  chosenWhites: (WhiteCard | null)[]
  playing: boolean
  windowWidth: number
  selectCard: (card: WhiteCard) => void
}

const HandView = ({ game, chosenWhites, playing, windowWidth, selectCard }: HandViewProps) => {
  if (!game.running)
    return null

  let scale = 1
  for (let rows = 1; rows < game.hand.length; rows++) {
    const cardsPerRow = Math.ceil(game.hand.length / rows)
    const unscaledRowWidth = 5 + 205 * cardsPerRow
    scale = Math.min(1, windowWidth / unscaledRowWidth)
    if (scale >= MINIMUM_CARD_SCALE) break
  }
  scale = Math.max(scale, MINIMUM_CARD_SCALE)

  return (
      <div className="hand">
        <h3>Your hand</h3>
        <div className="cards">
          {game.hand.map(card =>
            <WhiteCardView
                key={card.id}
                card={card}
                disabled={!game.shouldPlayWhiteCards || chosenWhites.some(chosen => chosen && chosen.id === card.id)}
                scale={scale}
                onClick={() => !playing && selectCard(card)}/>
          )}
        </div>
      </div>
  )
}

type GameScreenProps = {
  connection: GameSocket
  eventHandler: GameEventHandler
  user: UserSession
  game: GameState
  windowWidth: number
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
            this.props.eventHandler.error("The game cannot start because there are no black cards in the selected " +
                "card packs.")
            break
          case "too_few_white_cards":
            this.props.eventHandler.error("The game cannot start because there are too few white cards in the " +
                "selected card packs for this many players.")
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
          <InstructionsView
              game={game}
              chosenWhites={this.state.chosenWhites!}
              selectedWhitePos={this.state.selectedWhitePos} />
          <TableView
              game={game}
              chosenWhites={this.state.chosenWhites!}
              selectedWhitePos={this.state.selectedWhitePos}
              playing={this.state.playing}
              windowWidth={this.props.windowWidth}
              unselectCard={unselectCard}
              selectPos={pos => this.setState({selectedWhitePos: pos})}
              confirmPlay={confirmPlay}
              confirmJudge={confirmJudge} />
          <HandView
              game={game}
              chosenWhites={this.state.chosenWhites!}
              playing={this.state.playing}
              windowWidth={this.props.windowWidth}
              selectCard={selectCard} />
        </div>
    )
  }
}

const getWindowWidth = () => document.documentElement.clientWidth

export default (props: {game: GameState, chatMessages: any}) => {
  // TODO make sure that the use of clientWidth, which excludes the scrollbar, doesn't cause the view to oscillate
  //  or overflow into the vertical scrollbar
  const [windowWidth, setWindowWidth] = useState(getWindowWidth())

  useEffect(() => {
    const listener = () => {
      setWindowWidth(getWindowWidth())
    }
    window.addEventListener("resize", listener)
    return () => {
      window.removeEventListener("resize", listener)
    }
  }, [])

  return (
    <UserContext.Consumer>
      {user => (
        <ConnectionContext.Consumer>
          {connection => (
            <EventContext.Consumer>
              {eventHandler => (
                <GameScreen
                    user={user!}
                    connection={connection!}
                    eventHandler={eventHandler!}
                    windowWidth={windowWidth}
                    {...props} />
              )}
            </EventContext.Consumer>
          )}
        </ConnectionContext.Consumer>
      )}
    </UserContext.Consumer>
  )
}
