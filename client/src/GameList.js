import React, { useEffect, useState } from "react"
import "./GameList.css"
import Loader from "./Loader"
import { useMounted } from "./utils"

const GameList = ({ connection, user }) => {
  const [games, setGames] = useState(null)
  const [forcedUpdate, setForcedUpdate] = useState(null)

  const mounted = useMounted()

  useEffect(() => {
    setGames(null)
    connection.call("game_list")
      .then(response => {
        if (!mounted.is) return
        setGames(response.games)
      })
      .catch(error => {
        if (!mounted.is) return
        setGames("error")
      })
  }, [forcedUpdate, connection])

  const handleLogout = async () => {
    try {
      await connection.logout()
    } catch (error) {
      console.error(error)
    }
  }

  let gameList
  if (games === null) {
    gameList = (
      <Loader className="dark">Loading games&hellip;</Loader>
    )
  } else if (games === "error") {
    gameList = (
      <div className="error">Failed to retrieve game list.</div>
    )
  } else {
    let testGames = games.slice()
    const gameCards = testGames.map(game => 
      <div className="game" key={game.id}>
        <h4 className="title">{game.title}</h4>
        <div className="players">Players: {game.players}/{game.player_limit}</div>
        <div className="password">{game.passworded ? "Requires password" : "Open"}</div>
        <button className="join">Join</button>
      </div>
    )
    for (let i = 0; i < 12; i++) {
      gameCards.push(<div className="game-spacer" key={`spacer ${i}`}></div>)
    }
    gameList = (
      <div className="games">
        {gameCards}
      </div>
    )
  }

  return (
    <div className="game-list">
      <div className="nav">
        <div className="create-game">
          <button type="button" onClick={null}>Create game</button>
        </div>
        <div className="join-private">
          <input type="text" size="5" maxLength="5" placeholder="Code"></input>
          <button type="button" onClick={null}>Join private game</button>
        </div>
        <div className="user-info">
          <div>Logged in as <b>{user.name}</b></div>
          <button type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>
      <div className="public-header">
        <h2>Public games</h2>
        <button type="button" className="refresh" onClick={() => setForcedUpdate([])}>Refresh</button>
      </div>
      {gameList}
    </div>
  )
}

export default GameList
