import React, { useContext, useState, useRef } from "react"
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

const OptionsInput = ({ game, name, type, label, title, ...attrs }) => {
  const connection = useContext(ConnectionContext)

  const [unsaved, setUnsaved] = useState(null)
  // use a ref because saved made by future renders need to
  // invalidate the updateIds of this render
  const updateIdRef = useRef(null)

  const fieldValue = unsaved === null ? game.options[name] : unsaved

  const handleChange = (forceSave) => async (e) => {
    // compute correct type of value
    const { name, type } = e.target
    let value = type === "checkbox" ? e.target.checked : e.target.value
    if (type === "number" && value.trim() !== "") value = +value
    // always validate the data and tell the result to the user
    const valid = e.target.reportValidity()
    // don't bother saving if there is no change
    if (unsaved === null && value === fieldValue) return
    // keep track of when the value has been changed
    const updateId = updateIdRef.current = uniqueId()
    // update the change in the UI
    setUnsaved(value)
    // save editable fields only when leaving, except for number input ticks
    const isNumberTick = type === "number" && e.nativeEvent.inputType === "insertReplacementText"
    if (!forceSave && !isNumberTick) return
    // reset the value when exiting an invalid field
    if (!valid && forceSave) {
      setUnsaved(null)
      return
    }
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
    if (updateId === updateIdRef.current) {
      setUnsaved(null)
      updateIdRef.current = null
    }
  }

  if (type === "checkbox") {
    attrs["checked"] = fieldValue
    attrs["onChange"] = handleChange(true)
  } else {
    attrs["value"] = fieldValue
    attrs["onChange"] = handleChange(false)
    attrs["onBlur"] = handleChange(true)
  }

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

  const defaultTitle = config.game.title.default.replace(/\{USER\}/g, game.players[0].name)

  return (
    <div className="options">
      <OptionsInput
        game={game}
        type="text"
        name="game_title"
        placeholder={defaultTitle}
        label="Game title"
        title="The title of the game, displayed in the public games list." />
      <OptionsInput
        game={game}
        type="checkbox"
        name="public"
        label="Public"
        title="If checked, the game will show up in the public games list." />
      <OptionsInput
        game={game}
        type="text"
        name="password"
        placeholder="(no password)"
        label="Password"
        title="The password required to join the game." />
      <OptionsInput
        game={game}
        type="number"
        name="think_time"
        min={config.game.think_time.min}
        max={config.game.think_time.max}
        required
        label="Think time"
        title="The number of seconds before a player is skipped for being idle." />
      <OptionsInput
        game={game}
        type="number"
        name="round_end_time"
        min={config.game.round_end_time.min}
        max={config.game.round_end_time.max}
        required
        label="Round end time"
        title="The number of seconds the round's winner is shown for before starting a new round." />
      <OptionsInput
        game={game}
        type="number"
        name="idle_rounds"
        min={config.game.idle_rounds.min}
        max={config.game.idle_rounds.max}
        required
        label="Idle rounds"
        title="The number of consecutive rounds a player must be idle to be kicked." />
      <OptionsInput
        game={game}
        type="number"
        name="blank_cards"
        min={config.game.blank_cards.count.min}
        max={config.game.blank_cards.count.max}
        required
        label="Blank cards"
        title="The number of blank white cards included in the deck." />
      <OptionsInput
        game={game}
        type="number"
        name="player_limit"
        min={config.game.player_limit.min}
        max={config.game.player_limit.max}
        required
        label="Max players"
        title="The maximum number of players in the game." />
      <OptionsInput
        game={game}
        type="number"
        name="point_limit"
        min={config.game.point_limit.min}
        max={config.game.point_limit.max}
        required
        label="Points to win"
        title="The number of points required to win the game." />
    </div>
  )
}

export default GameScreen
