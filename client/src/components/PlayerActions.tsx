import {ReactNode} from "react"

interface PlayerActionsProps {
  playerId: string
  children?: ReactNode
}

/**
 * Renders a player actions menu for the wrapped children.
 */
const PlayerActions = ({ children }: PlayerActionsProps) => {
  // TODO add actions menu
  return <>{children}</>
}

export default PlayerActions
