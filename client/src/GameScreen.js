import React from "react"
import "./GameScreen.scss"
import { useMounted, unknownError } from "./utils"

const GameScreen = ({ connection, user, game }) => {
  const mounted = useMounted()

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

  let controls = null
  if (user.id === game.players[0].id) {
    controls = 
      <button type="button">Start game</button>
  }

  return (
    <div className="in-game">
      <div className="nav">
        <div className="game-controls">
          {controls}
        </div>
        <div className="game-info">
          <div className="game-code">Game <b>{game.game.code}</b></div>
          <button type="button" onClick={handleLeave}>Leave game</button>
        </div>
        <div className="user-info">
          <div className="user-name">Logged in as <b>{user.name}</b></div>
          <button type="button" onClick={handleLogout}>Log out</button>
        </div>
      </div>
    </div>
  )
}

export default GameScreen
