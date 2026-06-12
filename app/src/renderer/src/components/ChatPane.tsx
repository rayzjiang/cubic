import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ErrorNotice } from './ErrorNotice'
import { ContextFullCard } from './ContextFullCard'

/**
 * The active conversation: a thin draggable top strip + transcript + a notice band (transient errors,
 * context-full CTA) + composer. Navigation (Home, New chat, collapse) lives in the Sidebar.
 */
export function ChatPane() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />
      <MessageList />
      <ErrorNotice />
      <ContextFullCard />
      <InputBar />
    </div>
  )
}
