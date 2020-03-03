import React, { useContext, useState } from "react"
import "./GameScreen.scss"
import { useMounted, unknownError, uniqueId } from "./utils"
import { ConnectionContext, UserContext, ConfigContext } from "./contexts"

const GameScreen = ({ game }) => {
  const mounted = useMounted()
  const connection = useContext(ConnectionContext)
  const user = useContext(UserContext)

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
      <GameOptions game={game} />
    </div>
  )
}

const OptionsInput = ({ game, unsaved, name, type, label, title, ...attrs }) => {
  const value = name in unsaved ? unsaved[name].value : game.options[name]
  const valueAttr = type === "checkbox" ? "checked" : "value"
  attrs[valueAttr] = value

  return (
    <>
      <label
        htmlFor={`game-options-${name}`}
        title={title}>{label}</label>
      <input
        type={type}
        name={name}
        id={`game-options-${name}`}
        title={title}
        {...attrs} />
    </>
  )
}

const GameOptions = ({ game }) => {
  const config = useContext(ConfigContext)
  const connection = useContext(ConnectionContext)
  const [unsaved, setUnsaved] = useState({})

  const handleChange = async (e) => {
    if (!e.target.checkValidity()) return console.log("checked and was invalid")
    console.log("checked and was valid")
    const updateId = uniqueId()
    const { name, type } = e.target
    const value = type === "checkbox" ? e.target.checked : type === "number" ? +e.target.value : e.target.value
    // update the change in the UI
    setUnsaved({
      ...unsaved,
      [name]: { updateId, value }
    })
    // save the change
    try {
      await connection.call("game_options", {
        [name]: value
      })
    } catch (e) {
      unknownError(e)
    }
    // when the save finishes, delete the unsaved value, but only if no more
    // changes have been made while saving this one
    if (unsaved[name] && updateId === unsaved[name].updateId) {
      delete unsaved[name]
    }
  }

  console.log("rendered")

  const defaultTitle = config.game.title.default.replace(/\{USER\}/g, game.players[0].name)

  return (
    <div className="options">
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="text"
        name="game_title"
        onChange={handleChange}
        placeholder={defaultTitle}
        label="Game title"
        title="The title of the game, displayed in the public games list." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="checkbox"
        name="public"
        onChange={handleChange}
        label="Public"
        title="If checked, the game will show up in the public games list." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="text"
        name="password"
        onChange={handleChange}
        label="Password"
        title="The password required to join the game." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="think_time"
        min={config.game.think_time.min}
        max={config.game.think_time.max}
        required
        onChange={handleChange}
        label="Think time"
        title="The number of seconds before a player is skipped for being idle." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="round_end_time"
        min={config.game.round_end_time.min}
        max={config.game.round_end_time.max}
        required
        onChange={handleChange}
        label="Round end time"
        title="The number of seconds the round's winner is shown for before starting a new round." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="idle_rounds"
        min={config.game.idle_rounds.min}
        max={config.game.idle_rounds.max}
        required
        onChange={handleChange}
        label="Idle rounds"
        title="The number of consecutive rounds a player must be idle to be kicked." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="blank_cards"
        min={config.game.blank_cards.min}
        max={config.game.blank_cards.max}
        required
        onChange={handleChange}
        label="Blank cards"
        title="The number of blank white cards included in the deck." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="player_limit"
        min={config.game.player_limit.min}
        max={config.game.player_limit.max}
        required
        onChange={handleChange}
        label="Max players"
        title="The maximum number of players in the game." />
      <OptionsInput
        game={game}
        unsaved={unsaved}
        type="number"
        name="point_limit"
        min={config.game.point_limit.min}
        max={config.game.point_limit.max}
        required
        onChange={handleChange}
        label="Points to win"
        title="The number of points required to win the game." />
    </div>
  )
}

export default GameScreen
