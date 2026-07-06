import { describe, it, expect } from 'vitest';
import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

/**
 * P5W2 audit (L2) — the crown jewels (system prompt + tool catalog) must NEVER ship in the desktop
 * binary. The prod build aliases `@secrets` → `src/secrets/stub.ts` so the bytes are physically absent;
 * a stale direct-local `build/` (which bundles the REAL proxy secrets) would leak them if a future
 * electron-builder globbed it. This guard bundles both ways into a temp dir (never touches the real
 * build/) and asserts the prod bundle strips what the dev bundle contains. Mirrors build-ai.mjs's alias.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..'); // server/ai

const DEV_SECRETS = path.resolve(root, '..', '..', 'proxy', 'src', 'secrets', 'index.ts');
const STUB_SECRETS = path.join(root, 'src', 'secrets', 'stub.ts');

// A distinctive plain-ASCII phrase from the AE motion prompt (prompt/rules.ts). No quotes/newlines/
// backticks, so esbuild bundles it verbatim. If the prompt is reworded to drop it, the dev-bundle
// assertion below fails loudly → update this sentinel (keeps the detector honest).
const SENTINEL = 'Easing is the default';

async function bundle(secretsPath: string): Promise<string> {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cubic-leak-')), 'index.js');
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    packages: 'external',
    alias: { '@secrets': secretsPath },
  });
  return fs.readFileSync(outfile, 'utf8');
}

describe('crown jewels never ship in the prod bundle (L2)', () => {
  it('prod build (@secrets → stub) strips the system prompt that the dev build includes', async () => {
    const dev = await bundle(DEV_SECRETS);
    const prod = await bundle(STUB_SECRETS);
    expect(dev).toContain(SENTINEL); // sentinel is a real detector (dev bundle carries the prompt)
    expect(prod).not.toContain(SENTINEL); // and the shipped (prod) bundle does not
  }, 30_000);
});
