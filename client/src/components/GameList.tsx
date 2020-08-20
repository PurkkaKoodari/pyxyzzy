import React, {useEffect, useState, useContext, FormEvent, ChangeEvent} from "react"
import Modal from "react-modal"
import {toast} from "react-toastify"
import "./GameList.scss"
import Loader from "./Loader"
import {useMounted, unknownError} from "../utils"
import {ConfigContext, UserContext, ConnectionContext} from "./contexts"
import {GameListGame, GameListResponse} from "../api"

const CodeJoinForm = ({ joining, onJoin }: { joining: boolean, onJoin: (code: string) => void }) => {
  const config = useContext(ConfigContext)!
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
    if (joining || !codeValid) return
    onJoin(code)
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        className="game-code"
        maxLength={config.game.code.length}
        placeholder="Code"
        disabled={joining}
        value={code}
        onChange={handleCodeChange} />
      <button type="submit" disabled={joining || !codeValid}>Join by code</button>
    </form>
  )
}

const GameCard = ({ game, joining, onJoin }: { game: GameListGame, joining: boolean, onJoin: (code: string) => void }) => {
  return (
    <div className="game" key={game.code}>
      <h4 className="title">{game.title}</h4>
      <div className="code">{game.code}</div>
      <div className="players">Players: {game.players}/{game.player_limit}</div>
      <div className="password">{game.passworded ? "Requires password" : "Open"}</div>
      <button type="button" className="join" disabled={joining} onClick={() => onJoin(game.code)}>Join</button>
    </div>
  )
}

const GameList = ({ chatMessages }: { chatMessages: any[] }) => {
  const [games, setGames] = useState<GameListGame[] | "error" | null>(null)
  const [filter, setFilter] = useState("")
  const [forcedUpdate, setForcedUpdate] = useState<any>(null)
  const [joining, setJoining] = useState(false)
  const [joinModalCode, setJoinModalCode] = useState<string | null>(null)
  const [joinModalPassword, setJoinModalPassword] = useState("")
  const [joinModalIncorrect, setJoinModalIncorrect] = useState(false)

  const mounted = useMounted()
  // this component is only rendered when these exist
  const connection = useContext(ConnectionContext)!
  const user = useContext(UserContext)!

  useEffect(() => {
    setGames(null)
    connection.call<GameListResponse>("game_list")
      .then(response => {
        if (!mounted.is) return
        setGames(response.games)
      })
      .catch(() => {
        if (!mounted.is) return
        setGames("error")
      })
  }, [forcedUpdate, connection])

  const handleLogout = async () => {
    try {
      await connection.logout()
    } catch (error) {
      unknownError(error)
    }
  }

  const handleJoinGame = async (code: string, password: string = "") => {
    setJoining(true)
    try {
      await connection.call("join_game", { code, password }, true)
      if (!mounted.is) return
    } catch (error) {
      if (!mounted.is) return
      if (error.code === "password_required" || error.code === "password_incorrect") {
        setJoinModalCode(code)
        setJoinModalPassword("")
        setJoinModalIncorrect(error.code === "password_incorrect")
      } else if (error.code === "game_not_found") {
        toast.error("The game was not found.")
        setJoinModalCode(null)
      } else if (error.code === "game_full") {
        toast.error("The game is full.")
      } else if (error.code === "too_few_white_cards") {
        toast.error("The game has too few white cards in play for you to join.")
      } else {
        unknownError(error)
      }
    }
    setJoining(false)
  }

  const handleCreateGame = async () => {
    try {
      await connection.call("create_game", {}, true)
    } catch (error) {
      unknownError(error)
    }
  }

  const handleModalJoin = (e: FormEvent) => {
    e.preventDefault()
    if (joining) return
    handleJoinGame(joinModalCode!, joinModalPassword)
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
    const filtered = trimmed === "" ? games : games.filter(game => game.title.toUpperCase().includes(trimmed) || game.code.includes(trimmed))
    if (filtered.length === 0) {
      gameList = (
        <div className="no-games">{trimmed === "" ? "There are currently no public games." : "No public games match your search."}</div>
      )
    } else {
      const gameCards = filtered.map(game => <GameCard key={game.code} game={game} joining={joining} onJoin={handleJoinGame} />)
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
          <CodeJoinForm joining={joining} onJoin={handleJoinGame} />
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
          <button type="button" className="refresh" onClick={() => setForcedUpdate(new Object())}>Refresh</button>
        </div>
      </div>
      {gameList}
      <Modal
        isOpen={joinModalCode !== null}
        onRequestClose={() => !joining && setJoinModalCode(null)}
        shouldCloseOnOverlayClick={!joining}>
        <p className="help-text">The game requires a password to join.</p>
        <form onSubmit={handleModalJoin}>
          <input
            type="password"
            className="game-code"
            placeholder="Password"
            disabled={joining}
            value={joinModalPassword}
            onChange={(e) => setJoinModalPassword(e.target.value)} />
          <button type="submit" className="join" disabled={joining}>Join</button>
        </form>
        {joinModalIncorrect ? (<div className="error">The password is incorrect.</div>) : null}
      </Modal>
    </div>
  )
}

export default GameList
