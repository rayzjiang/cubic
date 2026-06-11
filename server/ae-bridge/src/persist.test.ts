import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Message } from 'cubic-ai';
import {
  encodeProjectPath,
  appendTurn,
  loadSession,
  listConversations,
  getConversation,
  deleteConversation,
  rekey,
} from './persist.js';

// ─── Test harness ─────────────────────────────────────────────────────────────────
// Point the store at a throwaway temp dir via CUBIC_SESSIONS_DIR — no real ~/.cubic touched.

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-persist-'));
  process.env.CUBIC_SESSIONS_DIR = tmpRoot;
});

afterEach(() => {
  delete process.env.CUBIC_SESSIONS_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const PROJ = '/Users/ray/Desktop/My Edit.aep';
const userStr = (t: string): Message => ({ role: 'user', content: t });
const asstStr = (t: string): Message => ({ role: 'assistant', content: t });
const asstTool = (id: string): Message => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'runScript', input: {} }] });
const userResult = (id: string): Message => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] });

// ─── encodeProjectPath ──────────────────────────────────────────────────────────────

describe('encodeProjectPath', () => {
  it('replaces every unsafe char with a single dash (CC-style, 1:1)', () => {
    expect(encodeProjectPath('/Users/ray/My Edit.aep')).toBe('-Users-ray-My-Edit-aep');
  });
  it('buckets the unsaved project under _untitled', () => {
    expect(encodeProjectPath('')).toBe('_untitled');
  });
  it('keeps alphanumerics, underscores, and dashes', () => {
    expect(encodeProjectPath('a_b-c1')).toBe('a_b-c1');
  });
  it('dashes Windows drive/separator chars too', () => {
    expect(encodeProjectPath('C:\\Users\\ray\\x.aep')).toBe('C--Users-ray-x-aep');
  });
});

// ─── appendTurn + loadSession round-trip ─────────────────────────────────────────────

describe('appendTurn / loadSession', () => {
  it('round-trips Message[] exactly across multiple appended turns', () => {
    const turn1: Message[] = [userStr('add a layer'), asstTool('t1'), userResult('t1'), asstStr('done')];
    const turn2: Message[] = [userStr('make it red'), asstStr('ok')];
    appendTurn('s1', PROJ, turn1);
    appendTurn('s1', PROJ, turn2);

    const session = loadSession('s1', PROJ);
    expect(session).not.toBeNull();
    expect(session!.id).toBe('s1');
    expect(session!.messages).toEqual([...turn1, ...turn2]); // full history, in order, structurally identical
  });

  it('writes one JSON object per line at the CC-style path', () => {
    appendTurn('s1', PROJ, [userStr('hi'), asstStr('hello')]);
    const file = path.join(tmpRoot, '-Users-ray-Desktop-My-Edit-aep', 's1.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(userStr('hi'));
    expect(JSON.parse(lines[1])).toEqual(asstStr('hello'));
  });

  it('is a no-op for an empty turn (no file, no index entry)', () => {
    appendTurn('s1', PROJ, []);
    expect(loadSession('s1', PROJ)).toBeNull();
    expect(listConversations(PROJ)).toHaveLength(0);
  });

  it('returns null when loading a conversation that does not exist', () => {
    expect(loadSession('nope', PROJ)).toBeNull();
  });
});

// ─── index.json: upsert, title, list ordering ────────────────────────────────────────

describe('index.json', () => {
  it('creates an entry with a truncated first-message title and updates lastActivity on later turns', () => {
    appendTurn('s1', PROJ, [userStr('make a bouncy logo intro')]);
    const first = getConversation('s1')!;
    expect(first.title).toBe('make a bouncy logo intro');
    expect(first.projectPath).toBe(PROJ);
    expect(first.renamed).toBe(false);

    const t0 = first.lastActivity;
    appendTurn('s1', PROJ, [userStr('second turn')]);
    const second = getConversation('s1')!;
    expect(second.title).toBe('make a bouncy logo intro'); // title is set once, from the first message
    expect(second.lastActivity).toBeGreaterThanOrEqual(t0);
  });

  it('truncates long titles to 60 chars + ellipsis and collapses whitespace', () => {
    const long = 'a'.repeat(80);
    appendTurn('s1', PROJ, [userStr(`  ${long}  `)]);
    const title = getConversation('s1')!.title;
    expect(title).toBe('a'.repeat(60) + '…');
  });

  it('lists a project\'s conversations most-recently-active first', () => {
    appendTurn('old', PROJ, [userStr('old one')]);
    appendTurn('new', PROJ, [userStr('new one')]);
    appendTurn('old', PROJ, [userStr('bump old')]); // bumps old's lastActivity above new's
    const ids = listConversations(PROJ).map((c) => c.id);
    expect(ids).toEqual(['old', 'new']);
  });

  it('scopes the list to the given project path', () => {
    appendTurn('a', '/proj/one.aep', [userStr('one')]);
    appendTurn('b', '/proj/two.aep', [userStr('two')]);
    expect(listConversations('/proj/one.aep').map((c) => c.id)).toEqual(['a']);
    expect(listConversations('/proj/two.aep').map((c) => c.id)).toEqual(['b']);
  });

  it('survives a corrupt index.json by starting fresh', () => {
    appendTurn('s1', PROJ, [userStr('hi')]);
    fs.writeFileSync(path.join(tmpRoot, 'index.json'), 'not json', 'utf8');
    // A subsequent append rebuilds a valid index (the JSONL files remain the source of truth).
    appendTurn('s2', PROJ, [userStr('yo')]);
    expect(getConversation('s2')).not.toBeNull();
  });
});

// ─── delete ───────────────────────────────────────────────────────────────────────

describe('deleteConversation', () => {
  it('removes both the JSONL and the index entry, keyed by id alone', () => {
    appendTurn('s1', PROJ, [userStr('hi')]);
    appendTurn('s2', PROJ, [userStr('yo')]);

    deleteConversation('s1');

    expect(loadSession('s1', PROJ)).toBeNull();
    expect(fs.existsSync(path.join(tmpRoot, '-Users-ray-Desktop-My-Edit-aep', 's1.jsonl'))).toBe(false);
    expect(listConversations(PROJ).map((c) => c.id)).toEqual(['s2']); // s2 untouched
  });

  it('is idempotent — deleting a missing conversation is a no-op', () => {
    expect(() => deleteConversation('ghost')).not.toThrow();
  });
});

// ─── rekey (unsaved → saved) ─────────────────────────────────────────────────────────

describe('rekey', () => {
  it('moves the JSONL into the new project dir and updates the index path', () => {
    appendTurn('s1', '', [userStr('drafting in an unsaved project')]); // lands under _untitled
    expect(fs.existsSync(path.join(tmpRoot, '_untitled', 's1.jsonl'))).toBe(true);

    rekey('s1', '', PROJ);

    expect(fs.existsSync(path.join(tmpRoot, '_untitled', 's1.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, '-Users-ray-Desktop-My-Edit-aep', 's1.jsonl'))).toBe(true);
    expect(getConversation('s1')!.projectPath).toBe(PROJ);
    // History is intact + loadable from the new path.
    expect(loadSession('s1', PROJ)!.messages).toEqual([userStr('drafting in an unsaved project')]);
    // And it now lists under the real project, not the untitled bucket.
    expect(listConversations(PROJ).map((c) => c.id)).toEqual(['s1']);
    expect(listConversations('')).toHaveLength(0);
  });

  it('is a no-op when the encoded path is unchanged', () => {
    appendTurn('s1', PROJ, [userStr('hi')]);
    expect(() => rekey('s1', PROJ, PROJ)).not.toThrow();
    expect(loadSession('s1', PROJ)!.messages).toEqual([userStr('hi')]);
  });

  it('updates the index even when no JSONL exists yet (turn not appended)', () => {
    // Simulate an index entry with no file (e.g. created then path changed before first flush).
    appendTurn('s1', '', [userStr('hi')]);
    fs.rmSync(path.join(tmpRoot, '_untitled', 's1.jsonl')); // drop the file, keep the index entry
    rekey('s1', '', PROJ);
    expect(getConversation('s1')!.projectPath).toBe(PROJ);
  });
});
