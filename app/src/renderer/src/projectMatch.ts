/**
 * Heuristic for "is this new .aep a version/Save-As of the one we just left?" — gates the project-switch
 * bar's "bring your chats forward" offer. It only ever surfaces an OFFER (never moves data on its own), so
 * a false positive is harmless: the user can decline.
 */

/** Strip a trailing version/increment marker from a basename (no extension). A plain trailing number needs
 *  a separator (so "clip2" keeps its 2 — it's part of the name), but a "v"-form is taken bare ("clipv2").
 *  Examples: myedit_1→myedit, clip_v2→clip, "clip 3"→clip, claudeTesting1→claudeTesting1 (no separator). */
function stripVersion(base: string): string {
  return base.replace(/(?:[ _]\d+|[ _]?v\d+)$/i, '')
}

const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/'))
const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1).replace(/\.aep$/i, '')

/**
 * Does `newPath` look like an Increment-and-Save / Save-As version of `oldPath`? True when they live in the
 * same folder and share a stem once a trailing version marker is removed — e.g. myedit → myedit_1,
 * clip_v1 → clip_v2, claudeTesting1 → claudeTesting1_1.
 */
export function isLikelyVersionOf(oldPath: string, newPath: string): boolean {
  if (!oldPath || !newPath || oldPath === newPath) return false
  if (dirOf(oldPath) !== dirOf(newPath)) return false
  const a = stripVersion(baseOf(oldPath))
  const b = stripVersion(baseOf(newPath))
  return a.length > 0 && a === b
}
