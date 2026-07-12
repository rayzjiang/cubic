import { MessageList } from './MessageList'
import { InputBar } from './InputBar'
import { ErrorNotice } from './ErrorNotice'
import { ContextFullCard } from './ContextFullCard'
import { useChatStore } from '../store'

/**
 * The active conversation: transcript + a notice band (transient errors, context-full CTA) + composer.
 * The full-width TopBar above owns window drag; navigation (Home, New chat, collapse) lives in the
 * Sidebar. Solid bg keeps the transcript crisp over the translucent chrome around it.
 *
 * NEW-CHAT layout (Claude-style): while the chat is empty (no messages, nothing running), the greeting
 * and composer sit as ONE vertically-centered group — equal flex spacers above and below squeeze them
 * to the middle. The moment a turn starts (first message / streaming), the spacers drop and the composer
 * pins to the bottom with the transcript filling above — the normal, existing-chat layout.
 */
export function ChatPane() {
  const centered = useChatStore((s) => s.items.length === 0 && !s.running && !s.compacting)
  return (
    <div className="flex h-full flex-col bg-neutral-900">
      {centered && <div className="min-h-0 flex-1" />}
      <MessageList />
      <ErrorNotice />
      <ContextFullCard />
      <InputBar />
      {centered && <div className="min-h-0 flex-1" />}
    </div>
  )
}
