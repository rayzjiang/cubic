// electron-builder afterPack hook — flip Electron fuses (§E-2) to harden the binary.
// CJS (the app is "type":"module", and electron-builder loads hooks via require).
//
// Runs AFTER packing but BEFORE electron-builder signs: flipping fuse bits mutates the Mach-O and
// invalidates any signature, so it MUST precede the real Developer ID signing that electron-builder
// does next. Hence resetAdHocDarwinSignature is false for signed builds (electron-builder re-signs).
// For an UNSIGNED dry-run (CSC_IDENTITY_AUTO_DISCOVERY=false, no identity), electron-builder won't
// re-sign, so we ad-hoc re-sign here (resetAdHocDarwinSignature=true) — otherwise the fuse-mutated
// arm64 binary has an invalid signature and macOS refuses to launch it.
const path = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

exports.default = async function afterPack(context) {
  // Only the macOS binary is produced in this wave.
  if (context.electronPlatformName !== 'darwin') return

  const productName = context.packager.appInfo.productFilename // "Cubic"
  const appPath = path.join(context.appOutDir, `${productName}.app`)
  const binary = path.join(appPath, 'Contents', 'MacOS', productName)

  const unsigned = process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'false'

  await flipFuses(binary, {
    version: FuseVersion.V1,
    // Signed build: leave unsigned for electron-builder to Developer-ID sign next.
    // Unsigned dry-run: ad-hoc re-sign so the fuse-mutated binary still launches locally.
    resetAdHocDarwinSignature: unsigned,

    // KEEP ON — the backend child spawns via `process.execPath` + ELECTRON_RUN_AS_NODE=1
    // (backend.ts). Disabling this would break the backend entirely. (A future utilityProcess
    // refactor would let this be disabled — tracked in POSTMVP.)
    [FuseV1Options.RunAsNode]: true,

    // Harden: encrypt cookies at rest; block NODE_OPTIONS injection + --inspect/--inspect-brk
    // (our spawn passes neither, so these don't affect the backend); enforce asar integrity +
    // refuse a disk-side app/ (we load app code only from app.asar).
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })

  console.log(`  [afterPack] fuses flipped (${unsigned ? 'ad-hoc re-signed for unsigned dry-run' : 'left unsigned for Developer ID signing'})`)
}
