import React, {ChangeEvent, FormEvent, useContext, useEffect, useState} from "react"
import Modal from "react-modal"
import {toast} from "react-toastify"
import "./GameList.scss"
import Loader from "./Loader"
import {handleAllErrorsAsUnknown, unknownError, useMounted} from "../utils"
import {ConfigContext, AppStateContext, UserContext, ActingContext} from "./contexts"
import {GameListGame} from "../api"

const CodeJoinForm = ({ onJoin }: { onJoin: (code: string) => void }) => {
  const config = useContext(ConfigContext)!
  const acting = useContext(ActingContext)
  const [code, setCode] = useState("")

  const codeValid = code.length === config.game.code.length

  const handleCodeChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newCode = e.target.value
      .toUpperCase()
      .replace(new RegExp(`[^${config.game.code.characters}]`, "g"), "")
    setCode(newCode)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (acting || !codeValid) return
    onJoin(code)
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        className="game-code"
        maxLength={config.game.code.length}
        placeholder="Code"
        disabled={acting}
        value={code}
        onChange={handleCodeChange} />
      <button type="submit" disabled={acting || !codeValid}>Join by code</button>
    </form>
  )
}

const GameCard = ({ game, onJoin }: { game: GameListGame, onJoin: (code: string) => void }) => {
  const acting = useContext(ActingContext)

  return (
    <div className="game" key={game.code}>
      <h4 className="title">{game.title}</h4>
      <div className="code">{game.code}</div>
      <div className="players">Players: {game.players}/{game.player_limit}</div>
      <div className="password">{game.passworded ? "Requires password" : "Open"}</div>
      <button type="button" className="join" disabled={acting} onClick={() => onJoin(game.code)}>Join</button>
    </div>
  )
}

const GameList = ({ chatMessages }: { chatMessages: any[] }) => {
  const [games, setGames] = useState<GameListGame[] | "error" | null>(null)
  const [filter, setFilter] = useState("")
  const [forcedUpdate, setForcedUpdate] = useState<any>(null)
  const [joinModalCode, setJoinModalCode] = useState<string | null>(null)
  const [joinModalPassword, setJoinModalPassword] = useState("")
  const [joinModalIncorrect, setJoinModalIncorrect] = useState(false)

  const mounted = useMounted()
  const app = useContext(AppStateContext)!
  const user = useContext(UserContext)!
  const acting = useContext(ActingContext)

  useEffect(() => {
    setGames(null)
    app.gameList()
      .then(response => {
        if (!mounted.is) return
        setGames(response.games)
      })
      .catch(() => {
        if (!mounted.is) return
        setGames("error")
      })
  }, [forcedUpdate, app])

  const handleLogout = handleAllErrorsAsUnknown(() => app.logout())

  const handleJoinGame = async (code: string, password: string = "") => {
    try {
      await app.joinGame(code, password)
    } catch (error) {
      if (!mounted.is) return
      switch (error.code) {
        case "password_required":
        case "password_incorrect":
          setJoinModalCode(code)
          setJoinModalPassword("")
          setJoinModalIncorrect(error.code === "password_incorrect")
          break
        case "game_not_found":
          toast.error("The game was not found.")
          setJoinModalCode(null)
          break
        case "game_full":
          toast.error("The game is full.")
          break
        case "too_few_white_cards":
          toast.error("The game has too few white cards in play for you to join.")
          break
        default:
          unknownError(error)
          break
      }
    }
  }

  const handleCreateGame = handleAllErrorsAsUnknown(() => app.createGame())

  const handleModalJoin = async (e: FormEvent) => {
    e.preventDefault()
    if (acting) return
    await handleJoinGame(joinModalCode!, joinModalPassword)
  }

  let gameList
  if (games === null) {
    gameList = (
      <Loader className="dark">Loading games&hellip;</Loader>
    )
  } else if (games === "error") {
    gameList = (
      <div className="no-games error">Failed to retrieve game list.</div>
    )
  } else {
    const trimmed = filter.trim().toUpperCase()
    const filtered = trimmed === "" ? games :
        games.filter(game => game.title.toUpperCase().includes(trimmed) || game.code.includes(trimmed))
    if (filtered.length === 0) {
      gameList = (
          <div className="no-games">
            {trimmed === "" ? "There are currently no public games." : "No public games match your search."}
          </div>
      )
    } else {
      const gameCards = filtered.map(game => <GameCard key={game.code} game={game} onJoin={handleJoinGame} />)
      for (let i = 0; i < 12; i++) {
        gameCards.push(<div className="game-spacer" key={`spacer ${i}`} />)
      }
      gameList = (
          <div className="games">
            {gameCards}
          </div>
      )
    }
  }

  return (
    <div className="game-list">
      <div className="nav">
        <div className="create-game">
          <button type="button" onClick={handleCreateGame}>Create game</button>
        </div>
        <div className="join-private">
          <CodeJoinForm onJoin={handleJoinGame} />
        </div>
        <div className="user-info">
          <div className="user-name">Logged in as <b>{user.name}</b></div>
          <button type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>
      <div className="public-header">
        <h2>Public games</h2>
        <div>
          <input
            type="text"
            className="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find&hellip;" />
          <button type="button" className="refresh" onClick={() => setForcedUpdate({})}>Refresh</button>
        </div>
      </div>
      {gameList}
      <Modal
        isOpen={joinModalCode !== null}
        onRequestClose={() => !acting && setJoinModalCode(null)}
        shouldCloseOnOverlayClick={!acting}>
        <p className="help-text">The game requires a password to join.</p>
        <form onSubmit={handleModalJoin}>
          <input
            type="password"
            className="game-code"
            placeholder="Password"
            disabled={acting}
            value={joinModalPassword}
            onChange={(e) => setJoinModalPassword(e.target.value)} />
          <button type="submit" className="join" disabled={acting}>Join</button>
        </form>
        {joinModalIncorrect ? (<div className="error">The password is incorrect.</div>) : null}
      </Modal>
    </div>
  )
}

export default GameList
