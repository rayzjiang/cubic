import { useState } from 'react'
import { useChatStore } from '../store'

/**
 * Friendly, non-blocking notice for a turn `error` event. Shows the mapped plain-English message, a
 * "Try again" that resends the last message, a "Details" expander with the raw SDK/transport text,
 * and a dismiss. (Delete-refusals surface as a toast, not here.)
 */
export function ErrorNotice() {
  const error = useChatStore((s) => s.error)
  const lastUserText = useChatStore((s) => s.lastUserText)
  const retry = useChatStore((s) => s.retry)
  const dismissError = useChatStore((s) => s.dismissError)
  const [showDetails, setShowDetails] = useState(false)

  if (!error) return null

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-2">
      <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-2.5">
        <div className="flex items-start gap-2 text-[13px]">
          <span className="mt-0.5 text-amber-300/80">!</span>
          <div className="min-w-0 flex-1">
            <p className="text-white/85">{error.friendly}</p>
            <div className="mt-1.5 flex items-center gap-3 text-[12px]">
              {lastUserText && error.retryable && (
                <button onClick={retry} className="text-blue-300 hover:underline">
                  Try again
                </button>
              )}
              <button onClick={() => setShowDetails((v) => !v)} className="text-white/40 hover:text-white/70">
                {showDetails ? 'Hide details' : 'Details'}
              </button>
              <button onClick={dismissError} className="ml-auto text-white/40 hover:text-white/70">
                Dismiss
              </button>
            </div>
            {showDetails && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-white/50">{error.raw}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
