import React, {ChangeEvent, useContext, useEffect, useRef, useState} from "react"
import "./GameOptions.scss"
import {uniqueId, unknownError} from "../utils"
import {AppStateContext, ConfigContext, GameContext} from "./contexts"
import PlayersView from "./PlayersView"

interface OptionsInputFieldProps {
  type: string
  name: string
  title?: string
  label: string
  handleChange: (forceSave: boolean) => (e: ChangeEvent<HTMLInputElement>) => void
  value: string | number | boolean
  [attr: string]: any
}

const OptionsInputField = ({ type, name, title, label, handleChange, value, ...attrs }: OptionsInputFieldProps) => {
  if (type === "checkbox") {
    return (
      <label className={`field type-${type}`}
          htmlFor={`game-options-${name}`}
          title={title}>
          {label}
          <input
            type={type}
            id={`game-options-${name}`}
            title={title}
            checked={value as boolean}
            onChange={handleChange(true)}
            {...attrs} />
      </label>
    )
  } else {
    return (
      <div className={`field type-${type}`}>
        <label
          htmlFor={`game-options-${name}`}
          title={title}>
          {label}
        </label>
        <input
          type={type}
          id={`game-options-${name}`}
          title={title}
          value={value as string}
          onChange={handleChange(false)}
          onBlur={handleChange(true)}
          {...attrs} />
      </div>
    )
  }
}

type OptionTypeName = "text" | "number" | "checkbox" | "card_packs"
type OptionValue = string | number | boolean | string[]

interface OptionsInputProps {
  name: string
  type: OptionTypeName
  [attr: string]: any
}

const OptionsInput = ({ name, type, ...attrs }: OptionsInputProps) => {
  const config = useContext(ConfigContext)!
  const app = useContext(AppStateContext)!
  const game = useContext(GameContext)!

  const [unsaved, setUnsaved] = useState<OptionValue | null>(null)
  // use a ref because saved made by future renders need to
  // invalidate the updateIds of this render
  const updateIdRef = useRef<number | null>(null)

  const fieldValue = unsaved === null ? game.options[name] : unsaved

  const doUpdate = async (forceSave: boolean, value: OptionValue, valid = true) => {
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
      await app.setGameOptions({[name]: value})
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
    const packs = fieldValue as string[]

    const handlePackChange = (packId: string) => (forceSave: boolean) => async (e: ChangeEvent<HTMLInputElement>) => {
      // add or remove the pack
      const newPacks = e.target.checked ? packs.concat(packId) : packs.filter(id => id !== packId)
      await doUpdate(forceSave, newPacks)
    }
  
    return (
        <>
          {config.card_packs.map(pack => (
            <OptionsInputField
                key={pack.id}
                type="checkbox"
                name={`cardpacks-${pack.id}`}
                value={packs.includes(pack.id)}
                handleChange={handlePackChange(pack.id)}
                label={pack.name}
                title={`${pack.black_cards} black cards\n${pack.white_cards} white cards`} />
          ))}
        </>
    )
  }

  const handleFieldChange = (forceSave: boolean) => async (e: ChangeEvent<HTMLInputElement>) => {
    // compute correct type of value
    let value: string | number | boolean = type === "checkbox" ? e.target.checked : e.target.value
    if (type === "number" && (value as string).trim() !== "") value = +value
    // always validate the data and tell the result to the user
    const valid = e.target.reportValidity()
    // force saving when using number input ticker
    const isNumberTick = type === "number" && (e.nativeEvent as InputEvent).inputType === "insertReplacementText"
    await doUpdate(forceSave || isNumberTick, value, valid)
  }

  return (
    <OptionsInputField
        type={type}
        name={name}
        value={fieldValue as (string | number | boolean)}
        handleChange={handleFieldChange}
        {...attrs as {label: string}} />
  )
}

const GameOptions = () => {
  const config = useContext(ConfigContext)!
  const app = useContext(AppStateContext)!
  const game = useContext(GameContext)!

  const [open, setOpen] = useState(false)

  const toggleOpen = () => setOpen(!game.running || !open)
  useEffect(() => setOpen(!game.running), [game.running])

  const openClass = !game.running ? "force open" : open ? "open" : ""
  
  const defaultTitle = config.game.title.default.replace(/\{USER\}/g, game.host.name)

  return (
    <div className={`options-container ${openClass}`}>
      <button type="button" className="top toggler" onClick={toggleOpen}>
        Game options <span className="arrow">&#x25BC;</span>
      </button>
      <div className="options">
        <div className="scroll">
          <div className="category joining">
            <h4>Joining</h4>
            <div className="category-contents">
              <OptionsInput
                  state={app}
                  type="text"
                  name="game_title"
                  placeholder={defaultTitle}
                  label="Game title"
                  title="The title of the game, displayed in the public games list." />
              <OptionsInput
                  state={app}
                  type="checkbox"
                  name="public"
                  label="Public"
                  title="If checked, the game will show up in the public games list." />
              <OptionsInput
                  state={app}
                  type="text"
                  name="password"
                  placeholder="(no password)"
                  label="Password"
                  title="The password required to join the game." />
              <OptionsInput
                  state={app}
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
            <div className="category-contents">
              <OptionsInput
                  state={app}
                  type="number"
                  name="think_time"
                  min={config.game.think_time.min}
                  max={config.game.think_time.max}
                  required
                  label="Think time"
                  title="The number of seconds before a player is skipped for being idle." />
              <OptionsInput
                  state={app}
                  type="number"
                  name="round_end_time"
                  min={config.game.round_end_time.min}
                  max={config.game.round_end_time.max}
                  required
                  label="Round end time"
                  title="The number of seconds the round's winner is shown for before starting a new round." />
              <OptionsInput
                  state={app}
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
            <div className="category-contents">
              <OptionsInput
                  type="number"
                  name="blank_cards"
                  min={config.game.blank_cards.count.min}
                  max={config.game.blank_cards.count.max}
                  required
                  label="Blank cards"
                  title="The number of blank white cards included in the deck." />
              <OptionsInput
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
            <div className="category-contents">
              <OptionsInput
                  state={app}
                  type="card_packs"
                  name="card_packs" />
            </div>
          </div>
          <div className="category playerlist">
            <h4>Players</h4>
            <PlayersView />
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
