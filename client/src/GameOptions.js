import React, { useContext, useState, useRef, useEffect } from "react"
import "./GameOptions.scss"
import { unknownError, uniqueId } from "./utils"
import { ConnectionContext, ConfigContext } from "./contexts"

const OptionsInputField = ({ type, name, title, label, handleChange, value, ...attrs }) => {
    if (type === "checkbox") {
      attrs["checked"] = value
      attrs["onChange"] = handleChange(true)
    } else {
      attrs["value"] = value
      attrs["onChange"] = handleChange(false)
      attrs["onBlur"] = handleChange(true)
    }
  
    return (
      <div className={`field type-${type}`}>
        <label
          htmlFor={`game-options-${name}`}
          title={title}>{label}</label>
        <input
          type={type}
          name={name}
          id={`game-options-${name}`}
          title={title}
          {...attrs} />
      </div>
    )
}

const OptionsInput = ({ game, name, type, ...attrs }) => {
  const config = useContext(ConfigContext)

  const connection = useContext(ConnectionContext)

  const [unsaved, setUnsaved] = useState(null)
  // use a ref because saved made by future renders need to
  // invalidate the updateIds of this render
  const updateIdRef = useRef(null)

  const fieldValue = unsaved === null ? game.options[name] : unsaved

  const doUpdate = async (forceSave, value, valid = true) => {
    // don't bother saving if there is no change
    // this will always continue for card pack changes
    if (unsaved === null && value === fieldValue) return
    // keep track of when the value has been changed
    const updateId = updateIdRef.current = uniqueId()
    // update the change in the UI
    setUnsaved(value)
    // save keyboard-editable fields only when leaving
    if (!forceSave) return
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

  if (type === "card_packs") {
    const handlePackChange = (packId) => (forceSave) => (e) => {
      // add or remove the pack
      const newPacks = e.target.checked ? fieldValue.concat(packId) : fieldValue.filter(id => id !== packId)
      doUpdate(forceSave, newPacks)
    }
  
    return config.card_packs.map(pack => (
      <OptionsInputField
        key={pack.id}
        type="checkbox"
        name={`cardpacks-${pack.id}`}
        value={fieldValue.includes(pack.id)}
        handleChange={handlePackChange(pack.id)}
        label={pack.name} />
    ))
  }

  const handleFieldChange = (forceSave) => (e) => {
    // compute correct type of value
    let value = type === "checkbox" ? e.target.checked : e.target.value
    if (type === "number" && value.trim() !== "") value = +value
    // always validate the data and tell the result to the user
    const valid = e.target.reportValidity()
    // force saving when using number input ticker
    const isNumberTick = type === "number" && e.nativeEvent.inputType === "insertReplacementText"
    doUpdate(forceSave || isNumberTick, value, valid)
  }

  return (
    <OptionsInputField
      type={type}
      name={name}
      value={fieldValue}
      handleChange={handleFieldChange}
      {...attrs} />
  )
}

const GameOptions = ({ game }) => {
  const config = useContext(ConfigContext)

  const [open, setOpen] = useState(false)

  const toggleOpen = () => setOpen(!game.running || !open)
  useEffect(() => setOpen(!game.running), [game.running])

  const openClass = !game.running ? "force open" : open ? "open" : ""
  
  const defaultTitle = config.game.title.default.replace(/\{USER\}/g, game.players[0].name)

  return (
    <div className={`options-container ${openClass}`}>
      <button type="button" className="top toggler" onClick={toggleOpen}>
        Game options <span className="arrow">&#x25BC;</span>
      </button>
      <div className="options">
        <div className="category joining">
          <h4>Joining</h4>
          <div>
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
              name="player_limit"
              min={config.game.player_limit.min}
              max={config.game.player_limit.max}
              required
              label="Max players"
              title="The maximum number of players in the game." />
          </div>
        </div>
        <div className="category idle">
          <h4>Idle timers</h4>
          <div>
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
          </div>
        </div>
        <div className="category rules">
          <h4>Rules</h4>
          <div>
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
              name="point_limit"
              min={config.game.point_limit.min}
              max={config.game.point_limit.max}
              required
              label="Points to win"
              title="The number of points required to win the game." />
          </div>
        </div>
        <div className="category packs">
          <h4>Cards</h4>
          <div>
            <OptionsInput
              game={game}
              type="card_packs"
              name="card_packs" />
          </div>
        </div>
        <button type="button" className="bottom toggler" onClick={toggleOpen}>
          Close &#x25B2;
        </button>
      </div>
    </div>
  )
}

export default GameOptions
