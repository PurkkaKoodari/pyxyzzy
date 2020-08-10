import {toast} from "react-toastify"
import React from "react"
import log from "loglevel"
import GameSocket from "./GameSocket"
import {UserSession} from "./state"
import {englishList} from "./utils"

export class GameEventHandler {
  chatMessages: any[] = []
  onChatMessagesChange: (messages: any[]) => void
  connection: GameSocket
  user: UserSession | null = null

  constructor(connection: GameSocket, onChatMessagesChange: (messages: any[]) => void) {
    this.onChatMessagesChange = onChatMessagesChange
    this.connection = connection
  }

  get userId() {
    return this.user && this.user.id
  }

  addChatMessage(message: any) {
    this.chatMessages.push(message)
    this.onChatMessagesChange(this.chatMessages)
  }

  error(message: string, autoClose?: number | false) {
    toast.error(message, {autoClose})
    this.addChatMessage(<span className="error">{message}</span>)
  }

  warning(message: string, autoClose?: number | false) {
    toast.warn(message, {autoClose})
    this.addChatMessage(<span className="error">{message}</span>)
  }

  info(message: string, autoClose?: number | false) {
    toast.info(message, {autoClose})
    this.addChatMessage(message)
  }

  log(message: string) {
    this.addChatMessage(message)
  }

  handle(event: any) {
    switch (event.type) {
      case "card_czar_idle":
        this.warning(`${event.player.name} (the Card Czar) was idle for too long. The white cards played this round will be returned to hands.`)
        break
      case "players_idle":
        this.warning(`${englishList(event.players.map((player: any) => player.name), ["was", "were"])} idle for too long and ${event.players.length === 1 ? "was" : "were"} skipped this round.`)
        break
      case "too_few_cards_played":
        this.warning("Too many players were idle this round. The white cards played this round will be returned to hands.")
        break
      case "player_join":
        this.info(`${event.player.name} joined the game.`)
        break
      case "player_leave":
        const you = event.player.id === this.userId
        switch (event.reason) {
          case "disconnect":
            if (!you) this.info(`${event.player.name} disconnected.`)
            break
          case "host_kick":
            if (you) this.error("You were kicked from the game.", false)
            else this.info(`${event.player.name} was kicked from the game.`)
            break
          case "idle":
            if (you) this.error("You were kicked from the game for being idle for too many rounds.", false)
            else this.warning(`${event.player.name} was kicked from the game for being idle for too many rounds.`)
            break
          case "leave":
          default:
            if (!you) this.info(`${event.player.name} left the game.`)
            break
        }
        break
      case "too_few_players":
        this.error("The game was stopped because too few players remained.")
        break
      case "card_czar_leave":
        this.error(`${event.player.name} (the Card Czar) has left the game. The white cards played this round will be returned to hands.`)
        break
      case "host_leave":
        this.info(`${event.new_host.name} is now the host.`)
        break
      case "chat_message":
        this.log(event.text)
        break
      default:
        log.error("unknown event", event)
        break
    }
  }
}
