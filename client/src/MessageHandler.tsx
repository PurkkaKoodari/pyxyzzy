import {toast} from "react-toastify"
import React from "react"

/**
 * Dispatches event messages to toasts and chat.
 */
export default class MessageHandler {
  private chatMessages: any[] = []
  onChatMessagesChange: (messages: any[]) => void = () => {}

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
}
