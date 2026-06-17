import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Session, type Message } from 'cubic-ai';

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
  /** Reserved: true once a user renames the title (no rename UI in v1 → always false). */
  renamed: boolean;
}

const TITLE_MAX = 60;

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
  const raw = firstUser && typeof firstUser.content === 'string' ? firstUser.content : 'New conversation';
  const text = raw.trim().replace(/\s+/g, ' ');
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text;
}

function upsertIndex(id: string, projectPath: string, newMessages: Message[]): void {
  const entries = readIndex();
  const existing = entries.find((e) => e.id === id);
  const now = Date.now();
  if (existing) {
    existing.lastActivity = now;
    existing.projectPath = projectPath; // stays in sync with the file's location (see rekey)
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
  return true;
}

/** Read a conversation's full history back into a fresh `Session`. Returns null if no JSONL exists. */
export function loadSession(id: string, projectPath: string): Session | null {
  let raw: string;
  try {
    raw = fs.readFileSync(sessionFile(projectPath, id), 'utf8');
  } catch {
    return null;
  }
  const messages: Message[] = raw.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const session = new Session(id);
  session.messages = messages;
  return session;
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
