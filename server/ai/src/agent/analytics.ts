// §H — analytics sink for the agent brain. The brain runs inside the Electron backend child; it can't
// reach PostHog and doesn't know the user, so it just emits named events into a sink that the host
// (server/ae-bridge/startBackend.ts) installs to forward them UP to main over IPC — where identity is
// stamped and the event is sent. When no sink is installed (the MCP dev entrypoint, or unit tests),
// emit is a no-op. Never throws into the caller — telemetry must not affect the agent loop.

type AnalyticsSink = (event: string, props: Record<string, unknown>) => void;

let sink: AnalyticsSink | null = null;

/** Install the forwarder (the host wires this to `process.send({ type:'analytics', ... })`). Pass null
 *  to detach (tests). */
export function setAnalyticsSink(fn: AnalyticsSink | null): void {
  sink = fn;
}

/** Emit a named analytics event. Swallows all errors so telemetry never throws into the agent loop. */
export function emitAnalytics(event: string, props: Record<string, unknown>): void {
  if (!sink) return;
  try {
    sink(event, props);
  } catch {
    /* telemetry is best-effort — never throw into the caller */
  }
}
