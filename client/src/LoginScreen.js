import React, { useState, useContext } from "react"
import "./LoginScreen.scss"
import ExternalLink from "./ExternalLink"
import { useMounted } from "./utils"
import ConfigContext from "./ConfigContext"

const LoginScreen = ({ connection }) => {
  const config = useContext(ConfigContext)
  const [loggingIn, setLoggingIn] = useState(false)
  const [name, setName] = useState("")
  const [loginError, setLoginError] = useState(null)

  const mounted = useMounted()

  const nameProblems = []
  if (name.length < config.users.username.length.min)
    nameProblems.push(`Your name must be at least ${config.users.username.length.min} characters.`)
  if (new RegExp(`[^${config.users.username.characters}]`).test(name))
    nameProblems.push("Your name can only contain letters, numbers, dashes, underscores and spaces.")
  if (name.startsWith(" "))
    nameProblems.push("Your name can't start with a space.")
  if (name.endsWith(" "))
    nameProblems.push("Your name can't end with a space.")
  if (name.includes("  "))
    nameProblems.push("Your name can't contain two spaces in a row.")
  
  const canSubmit = !loggingIn && nameProblems.length === 0

  if (loginError)
    nameProblems.push(loginError === "name_in_use" ? "That name is already in use." : "Login failed with an unknown error.")

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setLoggingIn(true)
    try {
      await connection.login(name)
      if (!mounted.is) return
      setLoginError(null)
    } catch (error) {
      if (!mounted.is) return
      setLoginError(error.code)
    }
    setLoggingIn(false)
  }
  
  let nameProblemList = null
  if (name !== "" && nameProblems.length) {
    nameProblemList = (
      <ul className="errors">
        {nameProblems.map(problem => (<li key={problem}>{problem}</li>))}
      </ul>
    )
  }

  return (
    <div className="login">
      <h1>pyXyzzy</h1>
      <p className="help-text">
        pyXyzzy is a <ExternalLink href="https://www.cardsagainsthumanity.com/">Cards Against Humanity</ExternalLink> clone,
        modeled after <ExternalLink href="https://github.com/ajanata/PretendYoureXyzzy">Pretend You're Xyzzy</ExternalLink>.
      </p>
      <p className="help-text">Choose a name to start playing.</p>
      <form onSubmit={handleLogin}>
        <input
          type="text"
          id="login-name"
          placeholder="Name"
          disabled={loggingIn}
          maxLength={config.users.username.length.max}
          value={name}
          onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!canSubmit}>Play</button>
      </form>
      {nameProblemList}
      <p className="legal">
        pyXyzzy is a clone of <ExternalLink href="https://www.cardsagainsthumanity.com/">Cards Against Humanity</ExternalLink>, which
        is available under the <ExternalLink href="https://creativecommons.org/licenses/by-nc-sa/2.0/">CC BY-NC-SA 2.0</ExternalLink> license.
        The source code is available on <ExternalLink href="#">TODO</ExternalLink> and licensed under
        the <ExternalLink href="https://opensource.org/licenses/MIT">MIT license</ExternalLink>.
      </p>
    </div>
  )
}

export default LoginScreen
