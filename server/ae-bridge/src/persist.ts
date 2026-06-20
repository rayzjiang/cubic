import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Session, buildSummaryMessage, type Message } from 'cubic-ai';

/**
 * Conversation persistence store — the host's on-disk transcript shelf.
 *
 * Mirrors Claude Code's per-project layout: one append-only JSONL per conversation at
 * `~/.cubic/sessions/<encoded-project-path>/<id>.jsonl` (one `Message` per line, full history —
 * compaction trims only the in-memory model context, never disk), plus a single global
 * `~/.cubic/sessions/index.json` holding lightweight metadata so the conversation list never has
 * to crack open every JSONL.
 *
 * The brain (cubic-ai) stays host-agnostic and owns the canonical `Message[]`; this module is the
 * ae-bridge host's concern (filesystem layout, titles, project keying) and only reads/writes the
 * public `Message` shape. Append happens per turn (crash-safe: at most the in-flight turn is lost,
 * never an orphaned tool_use/tool_result pair).
 */

/** Lightweight per-conversation metadata kept in the global `index.json` (drives the sidebar list). */
export interface ConversationMeta {
  /** Stable id = JSONL filename + the live `sessions` Map key. */
  id: string;
  /** Truncated first user message (placeholder title; no Haiku auto-title in v1). */
  title: string;
  /** AE project path this conversation belongs to (`""` = unsaved → the `_untitled` bucket). */
  projectPath: string;
  /** Epoch ms of the last appended turn — the sort key for the list. */
  lastActivity: number;
  /** True once a user renames the title via the sidebar (vs. the auto-derived first-message title). */
  renamed: boolean;
}

const TITLE_MAX = 60;
/** Placeholder auto-title for a chat with no first message yet (brand-new, or emptied by a restore). */
const NEW_CONVERSATION_TITLE = 'New conversation';

/** Root of the conversation store. Overridable via `CUBIC_SESSIONS_DIR` (tests point it at a tmp dir). */
function sessionsRoot(): string {
  return process.env.CUBIC_SESSIONS_DIR || path.join(os.homedir(), '.cubic', 'sessions');
}

/**
 * Claude-Code-style project-path encoding: every char that isn't filesystem-safe becomes a single
 * `-` (1:1, not collapsed, to minimise collisions). `/Users/ray/My Edit.aep` → `-Users-ray-My-Edit-aep`.
 * `""` (unsaved project) gets its own bucket. The true path is always recoverable from `index.json`,
 * so the encoding never has to be reversible.
 */
export function encodeProjectPath(projectPath: string): string {
  if (!projectPath) return '_untitled';
  return projectPath.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function projectDir(projectPath: string): string {
  return path.join(sessionsRoot(), encodeProjectPath(projectPath));
}

function sessionFile(projectPath: string, id: string): string {
  return path.join(projectDir(projectPath), `${id}.jsonl`);
}

function indexPath(): string {
  return path.join(sessionsRoot(), 'index.json');
}

function readIndex(): ConversationMeta[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // missing or corrupt → start fresh (the JSONL files remain the source of truth)
  }
}

/** Atomic index write: temp file + rename, so a crash never leaves a half-written index. */
function writeIndex(entries: ConversationMeta[]): void {
  const root = sessionsRoot();
  fs.mkdirSync(root, { recursive: true });
  const tmp = path.join(root, `.index.json.tmp-${process.pid}`);
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, indexPath());
}

/** Placeholder title from the first string user message, whitespace-collapsed + truncated. */
function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && typeof m.content === 'string');
  const raw = firstUser && typeof firstUser.content === 'string' ? firstUser.content : NEW_CONVERSATION_TITLE;
  const text = raw.trim().replace(/\s+/g, ' ');
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

/**
 * Re-derive an AUTO title (one the user hasn't manually renamed) from `messages` — used after a restore
 * rewrites which message comes first, including resetting to the "New conversation" placeholder when the
 * chat is now empty. Never overrides a manual rename (`renamed`), and no-ops if the title is unchanged.
 */
function retitleIfAuto(id: string, messages: Message[]): void {
  const entries = readIndex();
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.renamed) return;
  const title = deriveTitle(messages);
  if (entry.title === title) return;
  entry.title = title;
  writeIndex(entries);
}

function upsertIndex(id: string, projectPath: string, newMessages: Message[]): void {
  const entries = readIndex();
  const existing = entries.find((e) => e.id === id);
  const now = Date.now();
  if (existing) {
    existing.lastActivity = now;
    existing.projectPath = projectPath; // stays in sync with the file's location (see rekey)
    // A chat emptied by "restore to before this request" had its auto-title reset to the placeholder;
    // this turn is effectively its new first message, so re-derive (never overriding a manual rename).
    if (!existing.renamed && existing.title === NEW_CONVERSATION_TITLE) existing.title = deriveTitle(newMessages);
  } else {
    entries.push({ id, title: deriveTitle(newMessages), projectPath, lastActivity: now, renamed: false });
  }
  writeIndex(entries);
}

/**
 * Append a completed turn's new messages to the conversation's JSONL (one line per `Message`) and
 * upsert its index entry. The whole turn is appended in a single write so a crash can only lose an
 * uncommitted in-flight turn — never split a tool_use/tool_result pair. No-op for an empty turn.
 */
export function appendTurn(id: string, projectPath: string, newMessages: Message[], turnId?: string): void {
  if (newMessages.length === 0) return;
  fs.mkdirSync(projectDir(projectPath), { recursive: true });
  // Tag the turn's prompt line (its first string-content user message) with the pre-turn snapshot's
  // `turnId`, so the renderer can offer "restore to before this request" durably (survives reload).
  // The extra field is ignored by the LLM path (anthropic.ts only sends {role, content}); display
  // reads it via messagesToDisplayItems. Untagged old turns simply have no restore target.
  let tagged = false;
  const lines = newMessages.map((m) => {
    if (!tagged && turnId && m.role === 'user' && typeof m.content === 'string') {
      tagged = true;
      return JSON.stringify({ ...m, _turnId: turnId });
    }
    return JSON.stringify(m);
  }).join('\n') + '\n';
  fs.appendFileSync(sessionFile(projectPath, id), lines, 'utf8');
  upsertIndex(id, projectPath, newMessages);
}

/**
 * A persisted JSONL line MAY carry host-only metadata the LLM never sees (anthropic.ts sends only
 * {role, content}): `_turnId` tags a turn's prompt line (the restore target); `_compaction` + `_keptTurns`
 * mark a compaction summary marker (see appendCompactionMarker).
 */
type StoredMessage = Message & { _turnId?: string; _compaction?: boolean; _keptTurns?: number };

/** Parse a conversation's JSONL into its stored lines (metadata fields preserved). Null if no file. */
function readStoredMessages(id: string, projectPath: string): StoredMessage[] | null {
  let raw: string;
  try { raw = fs.readFileSync(sessionFile(projectPath, id), 'utf8'); }
  catch { return null; }
  return raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as StoredMessage);
}

/** Drop host-only metadata so a reconstructed model-context message is a clean {role, content}. */
function stripMeta(m: StoredMessage): Message {
  return { role: m.role, content: m.content };
}

/**
 * Append a compaction marker line — a Claude-Code-style boundary recorded in the transcript at the moment
 * compaction occurred. Written BEFORE the triggering turn's own messages (the caller appends it ahead of
 * appendTurn) so it sits between the summarized prefix and the new turn. Carries the summary (XML-wrapped,
 * byte-identical to the in-memory summary message via buildSummaryMessage) plus `_keptTurns` — how many
 * recent turns stayed verbatim — which loadSession uses to reconstruct the compacted model context.
 * `_compaction` is the discriminator; both extra fields are stripped on the LLM wire.
 */
export function appendCompactionMarker(id: string, projectPath: string, summary: string, keptTurns: number): void {
  fs.mkdirSync(projectDir(projectPath), { recursive: true });
  const marker: StoredMessage = { ...buildSummaryMessage(summary), _compaction: true, _keptTurns: keptTurns };
  fs.appendFileSync(sessionFile(projectPath, id), JSON.stringify(marker) + '\n', 'utf8');
}

/**
 * Compacted MODEL context from the stored lines. Mirrors Claude Code: from the LAST compaction marker,
 * keep its summary + the last `_keptTurns` verbatim turns before it + every turn appended after it, and
 * drop all marker lines. Walking back by turn-tagged prompt lines (`_turnId`) means steers and earlier
 * markers never miscount the boundary. No marker → the full history, unchanged.
 */
function reconstructModelContext(all: StoredMessage[]): Message[] {
  let markerIdx = -1;
  for (let i = all.length - 1; i >= 0; i--) { if (all[i]._compaction) { markerIdx = i; break; } }
  if (markerIdx === -1) return all.map(stripMeta);

  const keptTurns = all[markerIdx]._keptTurns ?? 0;
  let sliceStart = 0; // fewer than keptTurns turns precede the marker → keep all of them (safe over-keep)
  let seen = 0;
  for (let i = markerIdx - 1; i >= 0; i--) {
    if (all[i]._turnId) { seen++; if (seen === keptTurns) { sliceStart = i; break; } }
  }
  const summaryMsg: Message = { role: 'user', content: String(all[markerIdx].content) };
  const tail = [...all.slice(sliceStart, markerIdx), ...all.slice(markerIdx + 1)]
    .filter((m) => !m._compaction)
    .map(stripMeta);
  return [summaryMsg, ...tail];
}

/**
 * Truncate a conversation's JSONL to BEFORE the turn tagged with `turnId` (the "restore to before this
 * request" rewind): drop that turn's prompt line and everything after it. One-way — there is no redo
 * (mirrors the backup pruning). Returns true if the turn was found + cut, false if the id wasn't present.
 */
export function truncateToBeforeTurn(id: string, projectPath: string, turnId: string): boolean {
  const file = sessionFile(projectPath, id);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return false;
  }
  const lines = raw.split('\n').filter((line) => line.trim());
  const cut = lines.findIndex((line) => {
    try { return (JSON.parse(line) as { _turnId?: string })._turnId === turnId; } catch { return false; }
  });
  if (cut < 0) return false;
  const kept = lines.slice(0, cut);
  fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
  // The title may have been derived from a message we just cut — re-derive the auto-title from what
  // remains (or reset to the placeholder if the chat is now empty), so the sidebar never shows a title
  // for a message that no longer exists. Manual renames are preserved.
  const keptMessages = kept
    .map((line) => { try { return JSON.parse(line) as Message; } catch { return null; } })
    .filter((m): m is Message => m !== null);
  retitleIfAuto(id, keptMessages);
  return true;
}

/**
 * Reconstruct a conversation's MODEL context into a fresh `Session` (NOT the full transcript — that's
 * `loadDisplayMessages`, for the chat pane). If the conversation was compacted, the model resumes from
 * the last summary + the verbatim turns kept at that compaction + every turn since, so reopening never
 * re-summarizes already-summarized history. With no marker this is the full history, unchanged. `null`
 * if no JSONL exists.
 */
export function loadSession(id: string, projectPath: string): Session | null {
  const all = readStoredMessages(id, projectPath);
  if (!all) return null;
  const session = new Session(id);
  session.messages = reconstructModelContext(all);
  session.lastContextTokens = 0; // fresh load: next chat() re-measures it → no false compaction trigger
  return session;
}

/**
 * The FULL committed transcript (every line, metadata preserved) for the chat pane — distinct from
 * `loadSession`'s compacted model context. `messagesToDisplayItems` reads the `_compaction` markers here
 * to render the "Summarized earlier steps" dividers in place. `null` if no JSONL exists.
 */
export function loadDisplayMessages(id: string, projectPath: string): Message[] | null {
  return readStoredMessages(id, projectPath);
}

/** A project's conversations, most-recently-active first (drives ⑤'s sidebar list). */
export function listConversations(projectPath: string): ConversationMeta[] {
  return readIndex()
    .filter((e) => e.projectPath === projectPath)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

/**
 * Best guess for the current project BEFORE the AE worker connects: the project of the
 * most-recently-active conversation. Lets the sidebar/home list load instantly from disk (like
 * Claude Code) with no wait on AE; the authoritative list is pushed once the worker connects, which
 * only changes anything if the user opened a different project than last time. Null if no history.
 */
export function lastActiveProjectPath(): string | null {
  const entries = readIndex();
  if (entries.length === 0) return null;
  return entries.reduce((best, e) => (e.lastActivity > best.lastActivity ? e : best)).projectPath;
}

/** Look up one conversation's metadata by id (used to find its stored project path before a rekey). */
export function getConversation(id: string): ConversationMeta | null {
  return readIndex().find((e) => e.id === id) ?? null;
}

/**
 * Remove a chat's pre-turn backup folder (`.cubic-backups/<sessionId>/` next to the project `.aep`)
 * when its conversation is deleted or cleared, so orphaned full-`.aep` copies don't pile up. The
 * sessionId sanitization MUST match `_sessionBackupDir` in `scripts/bridge.jsx`. No-op for an unsaved
 * project (`""` → no backups exist) or if the folder is already gone.
 */
export function deleteSessionBackups(projectPath: string, sessionId: string): void {
  if (!projectPath) return;
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '-');
  const dir = path.join(path.dirname(projectPath), '.cubic-backups', safeId);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
}

/**
 * Rename a conversation: set a user-chosen title and mark it `renamed`. The title is sanitized the same
 * way as auto-titles (whitespace-collapsed, capped at TITLE_MAX) so a manual title can never break the
 * single-line list layout. No-op if the id isn't present or the cleaned title is empty — the renderer
 * already reverts on empty, this is the defensive backstop. Metadata-only: never touches the JSONL, so
 * it's safe to call mid-turn (unlike delete, which drops the live session).
 */
export function renameConversation(id: string, title: string): void {
  const clean = title.trim().replace(/\s+/g, ' ').slice(0, TITLE_MAX);
  if (!clean) return;
  const entries = readIndex();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.title = clean;
  entry.renamed = true;
  writeIndex(entries);
}

/** Delete a conversation: remove its JSONL + drop its index entry. Idempotent; keyed by id alone. */
export function deleteConversation(id: string): void {
  const entries = readIndex();
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    try { fs.unlinkSync(sessionFile(entry.projectPath, id)); } catch { /* already gone */ }
  }
  writeIndex(entries.filter((e) => e.id !== id));
}

/**
 * Re-home a conversation when its project path changes (unsaved → saved, or Save-As): move the
 * JSONL into the new encoded dir and update its index entry. No-op if the path is unchanged or no
 * file exists yet (a brand-new conversation whose first turn hasn't been appended).
 */
export function rekey(id: string, oldPath: string, newPath: string): void {
  if (encodeProjectPath(oldPath) === encodeProjectPath(newPath)) return;
  const oldFile = sessionFile(oldPath, id);
  const newFile = sessionFile(newPath, id);
  try {
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.renameSync(oldFile, newFile);
  } catch { /* nothing persisted yet → only the index entry needs updating */ }
  const entries = readIndex();
  const entry = entries.find((e) => e.id === id);
  if (entry) {
    entry.projectPath = newPath;
    writeIndex(entries);
  }
}

/**
 * Carry every conversation from one project to another, keeping the originals (used when AE
 * increments/Save-As to a new file and the user opts to "bring my chats to the new version"). Unlike
 * `rekey` (a move), this COPIES each transcript under a FRESH id: the live `sessions` Map and
 * `getConversation` are keyed by id alone, so a shared id across two project paths would make lookups
 * ambiguous. `fromPath` keeps its own copies, so each version retains its history snapshot. Returns the
 * number of conversations copied. No-op (returns 0) when source and destination encode to the same dir.
 */
export function copyConversations(fromPath: string, toPath: string): number {
  if (encodeProjectPath(fromPath) === encodeProjectPath(toPath)) return 0;
  const entries = readIndex();
  const sources = entries.filter((e) => e.projectPath === fromPath);
  let copied = 0;
  for (const src of sources) {
    const newId = crypto.randomUUID();
    const newFile = sessionFile(toPath, newId);
    try {
      fs.mkdirSync(path.dirname(newFile), { recursive: true });
      fs.copyFileSync(sessionFile(fromPath, src.id), newFile);
    } catch { continue; /* nothing persisted on disk for this conversation → skip it */ }
    entries.push({ id: newId, title: src.title, projectPath: toPath, lastActivity: src.lastActivity, renamed: src.renamed });
    copied++;
  }
  if (copied > 0) writeIndex(entries);
  return copied;
}
