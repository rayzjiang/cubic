// Loads the single shared `server/.env` (ANTHROPIC_API_KEY + optional CUBIC_MODEL) regardless of
// cwd. Replaces a bare `import 'dotenv/config'`, which only saw the now-removed per-package
// server/ai/.env. Side-effect import — keep it FIRST so env is set before getLLM() reads it:
//   import './lib/loadEnv.mjs';
// Resolved relative to this file (tests/lib/ → ../../../ = server/) so it matches the one file the
// running app loads (server/ae-bridge/src/startBackend.ts → loadLocalEnv).
import dotenv from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });
