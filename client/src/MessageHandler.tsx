import {toast} from "react-toastify"
import React, {ReactNode} from "react"

export type ChatMessageType = "log" | "info" | "warning" | "error" | "chat"

/**
 * Represents a log/chat message. Immutable.
 */
export class ChatMessage {
  readonly time: Date
  readonly type: ChatMessageType
  readonly contents: ReactNode

  constructor(type: ChatMessageType, contents: ReactNode, time: Date = new Date()) {
    this.type = type
    this.contents = contents
    this.time = time
  }
}

/**
 * Dispatches event messages to toasts and chat.
 */
export default class MessageHandler {
  private chatMessages: ChatMessage[] = []
  onChatMessagesChange: (messages: any[]) => void = () => {}

  private add(message: ChatMessage) {
    this.chatMessages.push(message)
    this.onChatMessagesChange(this.chatMessages)
  }

  chat(message: ReactNode) {
    this.add(new ChatMessage("chat", message))
  }

  error(message: ReactNode, autoClose?: number | false) {
    toast.error(message, {autoClose})
    this.add(new ChatMessage("error", message))
  }

  warning(message: ReactNode, autoClose?: number | false) {
    toast.warn(message, {autoClose})
    this.add(new ChatMessage("warning", message))
  }

  info(message: ReactNode, autoClose?: number | false) {
    toast.info(message, {autoClose})
    this.add(new ChatMessage("info", message))
  }

  log(message: ReactNode) {
    this.add(new ChatMessage("log", message))
  }
}
