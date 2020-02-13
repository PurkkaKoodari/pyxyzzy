import React from "react"
import Loader from "./Loader"

const CONNECTING_TEXTS = {
  connecting: "Connecting\u2026",
  reconnecting: "Connection lost, reconnecting\u2026",
  retrying: "Connection failed, retrying after %SECS%s\u2026",
  connected_elsewhere: "You have opened the game in another tab. You can return to this tab by refreshing the page."
}

const ConnectingScreen = ({ state, retryTime }) => (
  <div className="connecting-overlay">
    <Loader>{CONNECTING_TEXTS[state].replace("%SECS%", retryTime)}</Loader>
  </div>
)

export default ConnectingScreen
