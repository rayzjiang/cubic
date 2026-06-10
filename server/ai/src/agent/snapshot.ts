import { bridgeClient } from '../bridge/client.js';

export interface SnapshotResult {
  ok: boolean;
  /** Absolute path of the backup .aep on success. */
  path?: string;
  /** Why the snapshot was skipped/failed (e.g. project never saved). */
  reason?: string;
}

/**
 * Pre-turn revert point. Asks AE to flush the project to disk and copy the .aep into
 * a `.cubic-backups/` sibling (see `backupProject` in server/ae-bridge project.jsx). This is
 * an internal turn step — NOT a model-exposed tool, so it is intentionally absent from
 * the command registry/catalog and reached only via the internal bridgeClient path.
 *
 * Never throws: a failed snapshot (e.g. an unsaved project) is reported so the loop
 * can warn and proceed — the user still has per-command ⌘Z.
 */
export async function snapshotProject(turnId: string): Promise<SnapshotResult> {
  try {
    const result = await bridgeClient.callRunScript('backupProject', { turnId });
    if (result && typeof result === 'object' && (result as { status?: string }).status === 'error') {
      const r = result as { message?: string; errorCode?: string };
      return { ok: false, reason: r.message ?? r.errorCode ?? 'snapshot failed' };
    }
    const path = (result as { backupPath?: string } | undefined)?.backupPath;
    return { ok: true, path };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
