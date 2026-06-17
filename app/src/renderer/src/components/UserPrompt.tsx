import { useChatStore } from '../store'

/**
 * A user prompt, Cursor-style: a subtle bordered/tinted container that marks where a request starts.
 * No avatar, no bubble — the assistant response flows full-width below it. When the turn has a
 * pre-turn backup (`turnId`) and nothing is running, a hover-revealed "Restore" affordance rewinds the
 * project + chat to before this request (confirmed first — it's one-way).
 */
export function UserPrompt({ text, turnId }: { text: string; turnId?: string }) {
  const requestRestore = useChatStore((s) => s.requestRestore)
  const running = useChatStore((s) => s.running)

  return (
    <div className="group relative rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14px] whitespace-pre-wrap text-white/90">
      {text}
      {turnId && !running && (
        <button
          onClick={() => requestRestore(turnId)}
          className="absolute right-1.5 top-1.5 hidden rounded-md bg-neutral-800/80 px-2 py-1 text-[11px] text-white/45 hover:bg-white/10 hover:text-white/80 group-hover:block"
          title="Restore the project to before this request"
        >
          Restore
        </button>
      )}
    </div>
  )
}
