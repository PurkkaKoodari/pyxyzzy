import {FormEvent, useContext, useEffect, useRef, useState} from "react"
import "./ChatView.scss"
import {ChatMessage} from "../MessageHandler"
import {AppStateContext, ChatContext, GameContext} from "./contexts"

interface ChatMessageProps {
  message: ChatMessage
}

const ChatMessageView = ({ message }: ChatMessageProps) => {
  // TODO: better timestamp formatting?
  return (
      <div className={`message type-${message.type}`}>
        <span className="timestamp">[{message.time.toLocaleTimeString()}]</span> {message.contents}
      </div>
  )
}

interface ChatViewProps {
  chatMessages: ChatMessage[]
}

const ChatView = ({ chatMessages }: ChatViewProps) => {
  const app = useContext(AppStateContext)!
  const game = useContext(GameContext)

  const [open, setOpen] = useState(false)
  const [unseenPos, setUnseenPos] = useState(0)
  const [fieldText, setFieldText] = useState("")

  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open)
      setUnseenPos(chatMessages.length)
  }, [open, chatMessages.length])

  useEffect(() => {
    const scroll = scrollRef.current
    if (scroll) {
      scroll.scrollTo({
        top: scroll.scrollHeight - scroll.clientHeight,
        behavior: "smooth",
      })
    }
  }, [chatMessages.length])

  const unreadChats = open ? 0 : chatMessages.slice(unseenPos).filter(msg => msg.type === "chat").length

  const toggleOpen = () => setOpen(!open)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (game)
      await app.sendChat(fieldText)
    setFieldText("")
  }

  return (
      <div className={`chat-container ${open ? "open" : ""} ${unreadChats ? "unread" : ""}`}>
        <div className="chat">
          <button type="button" className="toggler" onClick={toggleOpen}>
            Chat{unreadChats ? ` (${unreadChats})` : ""} <span className="arrow">&#x25B2;</span>
          </button>
          <ChatContext.Provider value={true}>
            <div className="messages" ref={scrollRef}>
              {chatMessages.map(message => <ChatMessageView message={message} />)}
            </div>
          </ChatContext.Provider>
          <form className="field" onSubmit={handleSubmit}>
            <input
                type="text"
                id="chat-input"
                title="Send messages to other players"
                placeholder="Send message"
                value={fieldText}
                onChange={e => setFieldText(e.target.value)}
                disabled={game === null} />
            <button
                type="submit"
                disabled={game === null}>
              Send
            </button>
          </form>
        </div>
      </div>
  )
}

export default ChatView
