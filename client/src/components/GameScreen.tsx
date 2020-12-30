import React, {Component, useContext} from "react"
import "./GameScreen.scss"
import {handleAllErrorsAsUnknown, range, unknownError, useWindowWidth} from "../utils"
import {ActingContext, AppStateContext, ConfigContext, GameContext, UserContext} from "./contexts"
import GameOptions from "./GameOptions"
import {BlackCardView, WhiteCardGroup, WhiteCardPlaceholder, WhiteCardView} from "./cards"
import {GameState, Player, WhiteCard} from "../state"

// minimum scale to render cards at. if this doesn't fit, well, you're screwed
const MINIMUM_CARD_SCALE = 0.7

interface InstructionsViewProps {
  chosenWhites: (WhiteCard | null)[]
  selectedWhitePos: number | null
}

const GameControls = () => {
  const app = useContext(AppStateContext)!
  const user = useContext(UserContext)!
  const game = useContext(GameContext)!
  const acting = useContext(ActingContext)

    const handleLeave = handleAllErrorsAsUnknown(() => app.leaveGame())

    const handleLogout = handleAllErrorsAsUnknown(() => app.logout())

    const handleStartStop = async () => {
      try {
        if (game.running)
          await app.stopGame()
        else
          await app.startGame()
      } catch (error) {
        switch (error.code) {
          case "too_few_players":
            app.messageHandler.error("The game cannot start because there are too few players.")
            break
          case "too_few_black_cards":
            app.messageHandler.error("The game cannot start because there are no black cards in the selected card " +
                "packs.")
            break
          case "too_few_white_cards":
            app.messageHandler.error("The game cannot start because there are too few white cards in the selected " +
                "card packs for this many players.")
            break
          default:
            unknownError(error)
            break
        }
      }
    }

  let controls = null
  if (game.isHost) {
    controls = (
        <button type="button" onClick={handleStartStop} disabled={acting}>
          {game.running ? "Stop game" : "Start game"}
        </button>
    )
  }

  return (
      <div className="nav">
        <div className="game-controls">
          {controls}
        </div>
        <div className="game-info">
          <div className="game-code">Game <b>{game.code}</b></div>
          <button type="button" onClick={handleLeave} disabled={acting}>Leave game</button>
        </div>
        <div className="user-info">
          <div className="user-name">Logged in as <b>{user.name}</b></div>
          <button type="button" onClick={handleLogout} disabled={acting}>Log out</button>
        </div>
      </div>
  )
}

const InstructionsView = ({ chosenWhites, selectedWhitePos }: InstructionsViewProps) => {
  const state = useContext(GameContext)!
  const user = useContext(UserContext)!

  let action = null
  if (state.shouldPlayWhiteCards) {
    const toPlay = chosenWhites.filter(card => card === null).length
    if (toPlay) {
      action = <>Play {toPlay} {toPlay === chosenWhites.length ? "" : "more "}card{toPlay > 1 ? "s" : ""}.</>
    } else {
      action = <>Confirm your selection{state.currentRound.pickCount > 1 ? "s" : ""}. Click a card to unselect.</>
    }
  } else if (state.state === "playing") {
    action = <>Waiting for the other players to play&hellip;</>
  } else if (state.shouldJudge) {
    if (selectedWhitePos === null) {
      action = <>Choose a winner.</>
    } else {
      action = <>Confirm your selection.</>
    }
  } else if (state.state === "judging") {
    action = <>Waiting for {state.cardCzar.name} to choose a winner&hellip;</>
  } else if (state.state === "round_ended") {
    if (state.roundWinner) {
      const name = state.roundWinner.id === user.id ? "You" : state.roundWinner.name
      action = <>{name} won the round. Next round starts in {state.options.round_end_time} seconds.</>
    } else {
      action = <>The round has been cancelled. Next round starts in {state.options.round_end_time} seconds.</>
    }
  }

  return action && <h3 className="instructions">{action}</h3>
}

interface TableViewProps {
  chosenWhites: (WhiteCard | null)[]
  selectedWhitePos: number | null
  windowWidth: number
  unselectCard(pos: number): void
  selectPos(pos: number): void
}

const TableView = ({ chosenWhites, selectedWhitePos,  windowWidth, unselectCard, selectPos }: TableViewProps) => {
  const app = useContext(AppStateContext)!
  const config = useContext(ConfigContext)!
  const game = useContext(GameContext)!
  const acting = useContext(ActingContext)

  if (!game.running)
    return null

  const confirmPlay = async () => {
    // ensure valid selections
    if (!game.shouldPlayWhiteCards || !chosenWhites!.every(card => card !== null))
      return
    try {
      await app.playWhiteCards(chosenWhites as WhiteCard[])
    } catch (error) {
      unknownError(error)
    }
  }

  const confirmJudge = async () => {
    // ensure a valid state
    if (!game.shouldJudge || selectedWhitePos === null || selectedWhitePos >= game.currentRound.whiteCards!.length)
      return
    try {
      await app.chooseWinner(game.currentRound.whiteCards![selectedWhitePos][0])
    } catch (error) {
      unknownError(error)
    }
  }

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
      const won = game.state === "round_ended" && game.currentRound.winningCardsId === group[0].id
      const selected = selectedWhitePos === pos
      const actions = selected ? (
          <button type="button" disabled={acting} onClick={() => confirmJudge()}>Confirm selection</button>
      ) : null
      return (
        <WhiteCardGroup
            key={group[0].id}
            cards={group.map(card => <WhiteCardView key={card.id} card={card} scale={scale} />)}
            active={won || selected}
            actions={actions}
            scale={scale}
            onClick={() => game.shouldJudge && !acting && selectPos(pos)} />
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
              onClick={() => game.shouldPlayWhiteCards && !acting && unselectCard(pos)} />
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
        <button type="button" onClick={() => confirmPlay()} disabled={acting || !allSelected}>
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
  chosenWhites: (WhiteCard | null)[]
  windowWidth: number
  selectCard: (card: WhiteCard) => void
}

const HandView = ({ chosenWhites, windowWidth, selectCard }: HandViewProps) => {
  const game = useContext(GameContext)!
  const acting = useContext(ActingContext)

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
                onClick={() => !acting && selectCard(card)}/>
          )}
        </div>
      </div>
  )
}

interface PlayerViewProps {
  player: Player
}

const PlayerView = ({ player }: PlayerViewProps) => {
  const game = useContext(GameContext)!

  let status = ""
  let thinking = false

  if (player.isThinking) {
    status = "Playing"
    thinking = true
  } else if (game.state === "judging" && player === game.cardCzar) {
    status = "Judging"
    thinking = true
  } else if (game.running && player === game.cardCzar) {
    status = "Card Czar"
  } else if (player === game.host) {
    status = "Host"
  }

  const leader = game.players.every(other => other.score <= player.score)

  return (
      <div className={`player ${thinking ? "thinking" : ""}`}>
        <div className="name">{player.name}</div>
        <div className={`score ${leader ? "leader" : ""}`}>{player.score} {player.score === 1 ? "point" : "points"}</div>
        <div className="status">
          {status}
          {thinking ? <div className="think-blob blob-1" /> : null}
          {thinking ? <div className="think-blob blob-2" /> : null}
          {thinking ? <div className="think-blob blob-3" /> : null}
        </div>
      </div>
  )
}

interface PlayersViewProps {

}

const PlayersView = ({}: PlayersViewProps) => {
  const game = useContext(GameContext)!

  return (
      <div className="players">
        {game.players.map(player =>
          <PlayerView
              key={player.id}
              player={player} />
        )}
      </div>
  )
}

type GameScreenProps = {
  game: GameState
  windowWidth: number
}

type GameScreenState = {
  currentRoundId: string | null
  currentGameState: string | null
  chosenWhites: (WhiteCard | null)[] | null
  selectedWhitePos: number | null
}

class GameScreen extends Component<GameScreenProps, GameScreenState> {
  state: GameScreenState = {
    currentRoundId: null,
    currentGameState: null,
    chosenWhites: null,
    selectedWhitePos: null,
  }

  static getDerivedStateFromProps(props: GameScreenProps, state: GameScreenState) {
    const {game} = props
    let newState = {}
    // clear chosen white cards if not playing any
    const roundIdIfRunning = game.running ? game.currentRound.id : null
    if (roundIdIfRunning !== state.currentRoundId || !game.shouldPlayWhiteCards) {
      newState = {
        ...newState,
        chosenWhites: game.running ? Array(game.currentRound.pickCount).fill(null) : null,
        currentRoundId: roundIdIfRunning,
      }
    }
    // reset chosen white card as this slot is used for different purposes in different states
    if (game.state !== state.currentGameState) {
      newState = {
        ...newState,
        selectedWhitePos: game.state === "playing" ? 0 : null,
        currentGameState: game.state,
      }
    }
    return newState
  }

  render() {
    const {game} = this.props

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
      const {chosenWhites, selectedWhitePos} = this.state
      // can't reselect a card
      if (chosenWhites!.some(chosen => chosen && chosen.id === card.id))
        return
      // ensure a valid slot is selected
      if (!game.running || selectedWhitePos === null || selectedWhitePos >= game.currentRound.pickCount)
        return
      // put the card in place
      const newChosenWhites = [...chosenWhites!]
      newChosenWhites[selectedWhitePos] = card
      // find a free slot, if any
      const nextFreePos = range(selectedWhitePos + 1, game.currentRound.pickCount)
          .concat(range(0, selectedWhitePos))
          .find(pos => newChosenWhites[pos] === null) ?? null
      this.setState({
        chosenWhites: newChosenWhites,
        selectedWhitePos: nextFreePos,
      })
    }

    return (
        <div className={`in-game game-state-${game.state} ${game.shouldJudge ? "should-judge" : ""} ${game.shouldPlayWhiteCards ? "should-play" : ""}`}>
          <GameControls />
          <GameOptions />
          <InstructionsView
              chosenWhites={this.state.chosenWhites!}
              selectedWhitePos={this.state.selectedWhitePos} />
          <TableView
              chosenWhites={this.state.chosenWhites!}
              selectedWhitePos={this.state.selectedWhitePos}
              windowWidth={this.props.windowWidth}
              unselectCard={unselectCard}
              selectPos={pos => this.setState({selectedWhitePos: pos})} />
          <PlayersView />
          <HandView
              chosenWhites={this.state.chosenWhites!}
              windowWidth={this.props.windowWidth}
              selectCard={selectCard} />
        </div>
    )
  }
}

export default (props: {chatMessages: any}) => {
  const windowWidth = useWindowWidth()

  return (
      <GameContext.Consumer>
        {game => (
            <GameScreen
                game={game!}
                windowWidth={windowWidth}
                {...props} />
        )}
      </GameContext.Consumer>
  )
}
