import React, { useEffect, useState } from "react"
import Modal from "react-modal"
import { toast } from "react-toastify"
import "./GameList.scss"
import Loader from "./Loader"
import { useMounted, unknownError } from "./utils"
import config from "./config"

const CodeJoinForm = ({ joining, onJoin }) => {
  const [code, setCode] = useState("")

  const codeValid = code.trim() !== ""

  const handleCodeChange = (e) => {
    const newCode = e.target.value
      .toUpperCase()
      .replace(new RegExp(`[^${config.GAME_ID_ALPHABET}]`, "g"), "")
    setCode(newCode)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (joining || !codeValid) return
    onJoin(code)
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        className="game-code"
        maxLength={config.GAME_ID_LENGTH}
        placeholder="Code"
        disabled={joining}
        value={code}
        onChange={handleCodeChange} />
      <button type="submit" disabled={joining || !codeValid}>Join by code</button>
    </form>
  )
}

const GameCard = ({ game, joining, onJoin }) => {
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

const GameList = ({ connection, user }) => {
  const [games, setGames] = useState(null)
  const [filter, setFilter] = useState("")
  const [forcedUpdate, setForcedUpdate] = useState(null)
  const [joining, setJoining] = useState(false)
  const [joinModalCode, setJoinModalCode] = useState(null)
  const [joinModalPassword, setJoinModalPassword] = useState("")
  const [joinModalIncorrect, setJoinModalIncorrect] = useState(false)

  const mounted = useMounted()

  useEffect(() => {
    setGames(null)
    connection.call("game_list")
      .then(response => {
        if (!mounted.is) return
        setGames(response.games)
      })
      .catch(error => {
        console.error(error)
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

  const handleJoinGame = async (code, password = "") => {
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

  const handleModalJoin = (e) => {
    e.preventDefault()
    if (joining) return
    handleJoinGame(joinModalCode, joinModalPassword)
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
      const gameCards = filtered.map(game => <GameCard game={game} joining={joining} onJoin={handleJoinGame} />)
      for (let i = 0; i < 12; i++) {
        gameCards.push(<div className="game-spacer" key={`spacer ${i}`}></div>)
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
          <button type="button" className="refresh" onClick={() => setForcedUpdate([])}>Refresh</button>
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
        {joinModalIncorrect ? (<div class="error">The password is incorrect.</div>) : null}
      </Modal>
    </div>
  )
}

export default GameList
