import PlayerActions from "./PlayerActions"
import {useContext} from "react"
import {ChatContext} from "./contexts"

interface EventPlayerRef {
  id: string
  name: string
}

interface EventPlayerMentionProps {
  player: EventPlayerRef
}

/**
 * A mention of a player in an event message. Renders as PlayerActions inside chat messages and as the player name
 * elsewhere (i.e. toasts).
 */
const EventPlayerMention = ({ player }: EventPlayerMentionProps) => {
  const isChatMessage = useContext(ChatContext)

  return isChatMessage ? (
      <PlayerActions playerId={player.id}>{player.name}</PlayerActions>
  ) : (
      <>{player.name}</>
  )
}

export default EventPlayerMention
