import React from "react"
import "./GameScreen.scss"
import { useMounted } from "./utils"

const GameScreen = ({ connection, game }) => {
  const mounted = useMounted()

  const handleLeave = async () => {
    try {
      await connection.call("leave_game")
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div>
      Yay, you are in game.
      <button type="button" onClick={handleLeave}>Leave</button>
    </div>
  )
}

export default GameScreen
