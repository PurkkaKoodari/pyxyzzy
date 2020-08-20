import React from "react"
import Loader from "./Loader"

const CONNECTING_TEXTS: { [key: string]: string } = {
  connect: "Connecting\u2026",
  reconnect: "Connection lost, reconnecting\u2026",
  retry_sleep: "Connection failed, retrying in %SECS%s\u2026",
  retry_reconnect: "Connection failed, retrying\u2026",
  connected_elsewhere: "You have opened the game in another tab. You can return to this tab by refreshing the page.",
  protocol_error: "Connection failed, refreshing page\u2026"
}

const ConnectingScreen = ({ state, retryTime }: { state: string, retryTime: number | undefined }) => (
  <div className="connecting-overlay">
    <Loader>{CONNECTING_TEXTS[state].replace("%SECS%", "" + retryTime)}</Loader>
  </div>
)

export default ConnectingScreen
