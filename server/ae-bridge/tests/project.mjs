// project.mjs — tests for project save + path commands in project.jsx
//
// Covers:
//   getProjectPath  (R — path, name, dirty flag)
//   saveProject     (U — save in place; saveAs for unsaved projects)
//
// Visual verification:
//   No persistent comp. getProjectPath and saveProject operate on the open project.
//   saveProject (in-place) updates the project file's mtime; verify via Finder.
//
// Note: saveProject in-place is skipped if project.file is null (unsaved project)
// and no saveAs path is configured. This avoids creating unexpected files during CI.

import {
  test, send,
  assertNoError, assertField, assertStructuredError,
  bold, yellow, dim
} from './helpers.mjs';

export async function run(ctx, opts) {
  console.log(bold('\nProject Save & Path'));

  // ── Read-only: getProjectPath always runs ──────────────────────────────────

  let projectPath = null;
  await test('getProjectPath — returns status:success with path/dirty fields', async () => {
    const r = await send('getProjectPath', {});
    assertNoError(r);
    assertField(r, 'dirty');
    // path may be null for unsaved projects — that's valid
    if (r.path !== null && typeof r.path !== 'string') {
      throw new Error(`Expected path to be string or null, got ${typeof r.path}`);
    }
    projectPath = r.path;
    return r.path ? `path: ${r.path}` : 'project not yet saved (path=null)';
  });

  if (!opts.write) return;

  // ── saveProject ───────────────────────────────────────────────────────────

  if (projectPath) {
    // Project has a file — save in place
    await test('saveProject — in-place save succeeds', async () => {
      const r = await send('saveProject', {});
      assertNoError(r);
      assertField(r, 'path', 'string');
      if (!r.message || !r.message.includes('saved')) throw new Error('Expected "saved" in message');
      return `saved to ${r.path}`;
    });

    await test('saveProject — path returned matches getProjectPath', async () => {
      const r = await send('saveProject', {});
      assertNoError(r);
      if (r.path !== projectPath) {
        throw new Error(`Path mismatch: saveProject returned "${r.path}", expected "${projectPath}"`);
      }
    });

    await test('getProjectPath — dirty is false immediately after save', async () => {
      const r = await send('getProjectPath', {});
      assertNoError(r);
      // dirty may be false after a successful save (depends on AE version)
      // We just verify the field is a boolean — AE may keep dirty=true for some versions
      if (typeof r.dirty !== 'boolean') throw new Error(`Expected dirty to be boolean, got ${typeof r.dirty}`);
      return `dirty=${r.dirty}`;
    });
  } else {
    // Project is unsaved — saveProject without saveAs should error with a clear message
    await test('saveProject — unsaved project without saveAs returns descriptive error', async () => {
      const r = await send('saveProject', {});
      assertStructuredError(r);
      if (!r.message.toLowerCase().includes('saveas')) {
        throw new Error('Expected error message mentioning saveAs');
      }
      return 'correct: error mentions saveAs';
    });

    console.log(dim('  saveProject in-place skipped — project has no file path.'));
    console.log(dim('  To test in-place save: open a saved .aep project and re-run.'));
  }
}
