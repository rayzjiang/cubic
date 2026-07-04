import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow, shell } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url)) // .../app/out/main

/**
 * The main app window. macOS-first chrome (vibrancy + inset traffic-lights) but every
 * mac-only BrowserWindow option is guarded behind `isMac` so Windows/Linux still launch.
 * Renderer is fully sandboxed — no node/fs/ws; it reaches main only through the preload's
 * contextBridge surface (window.cubic).
 */
export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    // 560 lets the window shrink well past the 768px responsive breakpoint, so the narrow overlay-drawer
    // layout has real range (e.g. two windows tiled on a 1440px display = 720 each).
    minWidth: 560,
    minHeight: 480,
    show: false,
    // mac shows vibrancy through a transparent body; other platforms get a solid bg.
    backgroundColor: isMac ? undefined : '#1e1e1e',
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const,
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // External links open in the user's browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite dev server URL (HMR) when present, else the built renderer.
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
