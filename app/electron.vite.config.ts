import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Three build targets (electron-vite convention): main + preload run in Node/Electron
// (deps externalized — never bundle `electron` or node built-ins); renderer is a normal
// Vite + React app rooted at src/renderer with HMR in dev.
//
// Prod config bake (§E packaging): a packaged .app has an EMPTY process.env, so the frozen
// PUBLIC config values must be compiled INTO the main bundle. On a prod packaging build
// (CUBIC_BUILD=prod) we read app/.env.production and `define`-inject them as __CUBIC_*__
// constants that config.ts reads (with a process.env fallback for dev). All baked values are
// public by design (Supabase anon key, PostHog write-only ingest key, proxy URL); the real
// secrets (service_role, ANTHROPIC_API_KEY) live only in the Worker. A plain `electron-vite build`
// (CUBIC_BUILD unset) bakes nothing → stays `local`, so dev/test builds are untouched.
// Mirrors the esbuild `define` precedent in server/ae-bridge/scripts/build-backend.mjs.
export default defineConfig(({ mode }) => {
  const isProd = process.env.CUBIC_BUILD === 'prod'
  // prefix '' → load ALL vars (these are main-process constants, not renderer import.meta.env).
  const env = loadEnv(mode, resolve(__dirname), '')
  const mainDefine = isProd
    ? {
        __CUBIC_SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL ?? ''),
        __CUBIC_SUPABASE_ANON_KEY__: JSON.stringify(env.SUPABASE_ANON_KEY ?? ''),
        __CUBIC_POSTHOG_KEY__: JSON.stringify(env.POSTHOG_KEY ?? ''),
        __CUBIC_PROXY_URL__: JSON.stringify(env.CUBIC_PROXY_URL ?? ''),
        __CUBIC_CONFIG_ENV__: JSON.stringify('prod'), // force prod ONLY in packaged builds
      }
    : {}

  return {
    main: {
      define: mainDefine,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          input: { index: resolve(__dirname, 'src/preload/index.ts') },
          // sandbox:true requires a CommonJS preload — Electron can't load an ESM (.mjs)
          // preload in a sandbox. Force CJS + a .cjs extension (the package is "type":"module").
          output: { format: 'cjs', entryFileNames: '[name].cjs' },
        },
      },
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
      build: {
        rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
      },
      plugins: [react(), tailwindcss()],
    },
  }
})
