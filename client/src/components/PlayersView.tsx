import React, {useContext} from "react"
import "./PlayersView.scss"
import {GameContext} from "./contexts"
import {Player} from "../state"

interface PlayerViewProps {
  player: Player
}

const PlayerView = ({player}: PlayerViewProps) => {
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
        <div className={`score ${leader ? "leader" : ""}`}>
          {player.score} {player.score === 1 ? "point" : "points"}
        </div>
        <div className="status">
          {status}
          <div className="think-blob blob-1" />
          <div className="think-blob blob-2" />
          <div className="think-blob blob-3" />
        </div>
      </div>
  )
}

const PlayersView = () => {
  const game = useContext(GameContext)!

  return (
      <div className="players">
        {game.players.map(player =>
            <PlayerView
                key={player.id}
                player={player}/>,
        )}
      </div>
  )
}

export default PlayersView
