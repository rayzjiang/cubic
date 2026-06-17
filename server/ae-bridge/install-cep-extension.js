// install-cep-extension.js
// Copies the built CEP extension into Adobe's CEP folder and enables PlayerDebugMode.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isDryRun = process.argv.includes('--dry-run');

const distDir = path.join(__dirname, 'cep-extension', 'dist');

if (!fs.existsSync(distDir)) {
  console.error('ERROR: cep-extension/dist/ not found. Run "npm run build:plugin" first.');
  process.exit(1);
}

const extensionId = 'com.cubic.ae-bridge';

const destDir = isMac
  ? path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', extensionId)
  : isWin
    ? path.join(os.homedir(), 'AppData', 'Roaming', 'Adobe', 'CEP', 'extensions', extensionId)
    : null;

if (!destDir) {
  console.error('ERROR: Unsupported platform. Install manually.');
  process.exit(1);
}

console.log('=== Cubic CEP Extension — Installation ===\n');
console.log(`Source: ${distDir}`);
console.log(`Dest:   ${destDir}`);

if (isDryRun) {
  console.log('\n[dry-run] Would copy extension and set PlayerDebugMode. No changes made.');
  printManualNotes();
  process.exit(0);
}

// ─── Copy extension ────────────────────────────────────────────────────────────

console.log('\nCopying extension…');
try {
  copyDir(distDir, destDir);
  console.log('  Done.');
} catch (err) {
  console.error(`ERROR copying files: ${err.message}`);
  console.error('Try running with sudo, or copy manually using the paths above.');
  process.exit(1);
}

// ─── Enable PlayerDebugMode ────────────────────────────────────────────────────

console.log('Enabling PlayerDebugMode (required for unsigned extensions)…');
const csxsVersions = ['11', '12'];

if (isMac) {
  for (const v of csxsVersions) {
    const cmd = `defaults write com.adobe.CSXS.${v} PlayerDebugMode 1`;
    if (isDryRun) {
      console.log(`  [dry-run] ${cmd}`);
    } else {
      try {
        child_process.execSync(cmd, { stdio: 'pipe' });
        console.log(`  com.adobe.CSXS.${v} PlayerDebugMode = 1`);
      } catch (err) {
        console.warn(`  Warning: could not set CSXS.${v}: ${err.message}`);
      }
    }
  }
} else if (isWin) {
  for (const v of csxsVersions) {
    const cmd = `reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`;
    if (isDryRun) {
      console.log(`  [dry-run] ${cmd}`);
    } else {
      try {
        child_process.execSync(cmd, { stdio: 'pipe' });
        console.log(`  HKCU\\Software\\Adobe\\CSXS.${v} PlayerDebugMode = 1`);
      } catch (err) {
        console.warn(`  Warning: could not set CSXS.${v}: ${err.message}`);
      }
    }
  }
}

console.log('\nInstallation complete.');
printManualNotes();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printManualNotes() {
  console.log('\nNext steps:');
  console.log('  1. Restart After Effects.');
  console.log('  2. Open: Window → Extensions → Cubic');
  console.log('  3. The panel should show "Connecting…" then "Connected" once "npm start" is running.\n');

  console.log('IMPORTANT: After Effects scripting permissions');
  if (isMac) {
    console.log('  After Effects → Settings → Scripting & Expressions');
  } else {
    console.log('  Edit → Preferences → Scripting & Expressions');
  }
  console.log('  Enable: "Allow Scripts to Write Files and Access Network"\n');
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
