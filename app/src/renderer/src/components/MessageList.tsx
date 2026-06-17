import { useEffect, useRef } from 'react'
import { useChatStore } from '../store'
import { UserPrompt } from './UserPrompt'
import { AssistantMessage } from './AssistantMessage'
import { ToolActionRow } from './ToolActionRow'
import { ProgressIndicator } from './ProgressIndicator'
import { CompactionPill } from './CompactionPill'

/**
 * The transcript. One flat DisplayItem[] (history + live share the shape) rendered in order: each
 * user prompt is boxed and starts a new "turn" (extra top spacing); assistant text + tool rows flow
 * full-width below it — the Cursor/Copilot look. Auto-scrolls to the newest content.
 */
export function MessageList() {
  const items = useChatStore((s) => s.items)
  const running = useChatStore((s) => s.running)
  const progressWord = useChatStore((s) => s.progressWord)
  const compacting = useChatStore((s) => s.compacting)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items, running, progressWord, compacting])

  if (items.length === 0 && !running && !compacting) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <h2 className="text-xl font-medium text-white/70">What are we building today?</h2>
        <p className="mt-2 max-w-sm text-sm text-white/35">Describe a look, a motion, or an edit — Cubic makes it for you in After Effects.</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-6">
        {items.map((it, i) => {
          if (it.kind === 'user') {
            return (
              <div key={i} className={i === 0 ? '' : 'mt-7'}>
                <UserPrompt text={it.text} turnId={it.turnId} />
              </div>
            )
          }
          if (it.kind === 'assistant') {
            return (
              <div key={i} className="mt-3">
                <AssistantMessage text={it.text} />
              </div>
            )
          }
          if (it.kind === 'interrupted') {
            return (
              <div key={i} className="mt-3 flex items-center gap-2 text-[12px] text-white/30">
                <span className="h-px flex-1 bg-white/10" />
                Stopped
                <span className="h-px flex-1 bg-white/10" />
              </div>
            )
          }
          return (
            <div key={i} className="mt-1.5">
              <ToolActionRow label={it.label} status={it.status} />
            </div>
          )
        })}
        {compacting && (
          <div className="mt-2">
            <CompactionPill />
          </div>
        )}
        {running && progressWord && (
          <div className="mt-2">
            <ProgressIndicator word={progressWord} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
