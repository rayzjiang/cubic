import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Assistant narration, full-width (no bubble). Rendered as Markdown (react-markdown + remark-gfm) —
 * NO rehype-raw, so no raw HTML is ever injected (safe in the sandboxed renderer). Styling lives in
 * `.md-body` (styles.css). Links are rendered inert for now (opening externally needs a future IPC).
 */
export function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="md-body text-[14px] leading-relaxed text-white/85">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} onClick={(e) => e.preventDefault()}>
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
