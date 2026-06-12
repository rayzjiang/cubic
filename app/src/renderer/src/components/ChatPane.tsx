import { MessageList } from './MessageList'
import { InputBar } from './InputBar'

/**
 * The active conversation: a thin draggable top strip + transcript + composer. Navigation (Home,
 * New chat, collapse) lives in the Sidebar. Error/compaction/context-full surfaces land in Step 5.
 */
export function ChatPane() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-9 shrink-0 [-webkit-app-region:drag]" />
      <MessageList />
      <InputBar />
    </div>
  )
}
