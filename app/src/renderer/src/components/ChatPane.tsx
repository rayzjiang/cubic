import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ErrorNotice } from './ErrorNotice'
import { ContextFullCard } from './ContextFullCard'

/**
 * The active conversation: transcript + a notice band (transient errors, context-full CTA) + composer.
 * The full-width TopBar above owns window drag; navigation (Home, New chat, collapse) lives in the
 * Sidebar. Solid bg keeps the transcript crisp over the translucent chrome around it.
 */
export function ChatPane() {
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      <MessageList />
      <ErrorNotice />
      <ContextFullCard />
      <InputBar />
    </div>
  )
}
