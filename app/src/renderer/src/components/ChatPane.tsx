import { useChatStore } from '../store'
import { MessageList } from './MessageList'
import { InputBar } from './InputBar'

/**
 * The active conversation: transcript + composer. Top chrome (back-to-home) is a thin draggable bar;
 * the real sidebar lands in Step 4. Error/compaction/context-full surfaces land in Step 5.
 */
export function ChatPane() {
  const goHome = useChatStore((s) => s.goHome)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center py-2 pr-3 pl-20 [-webkit-app-region:drag]">
        <button
          onClick={goHome}
          className="rounded-md px-2 py-1 text-[13px] text-white/55 [-webkit-app-region:no-drag] hover:bg-white/10 hover:text-white/80"
        >
          ← Home
        </button>
      </div>
      <MessageList />
      <InputBar />
    </div>
  )
}
