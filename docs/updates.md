# Releasing & shipping updates

Cubic ships as a signed + notarized macOS app that **auto-updates** from a private Cloudflare R2 feed, served read-only through the `cubic-proxy` Worker's `GET /releases/*`. Shipping a new version is two commands.

**One-time setup** (gitignored, in `app/`):
- `app/.env.signing` — `APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID` (Developer ID signing + notarization).
- `app/.env.release` — `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` (upload to the `cubic-releases` bucket; see `app/.env.release.example`).
- Worker deployed with its R2 binding (`cd proxy && npm run deploy`); the feed URL lives in `app/electron-builder.yml` `publish.url`.

**Ship an update:**
```bash
# 1. Bump app/package.json "version" (e.g. 0.1.0 → 0.1.1). ALWAYS bump — never reuse a shipped number.
rm -rf app/release            # drop stale artifacts from a prior version
cd app
npm run dist                  # build → obfuscate → sign → notarize → staple → dmg + zip + blockmap + latest-mac.yml
npm run release               # upload the signed artifacts + latest-mac.yml to R2
```
`npm run dist` writes `app/release/` — the `.dmg` (fresh installs) plus the `.zip` + `.blockmap` + `latest-mac.yml` (auto-update). `npm run release` uploads them; a shipped version is **immutable** in R2 (re-uploading the same number is refused unless you add `-- --force`).

**Rules of thumb:**
- **Always bump the version** before `dist` — electron-updater keys on the version string, so a client that already downloaded `X` won't cleanly pick up a *different* `X`.
- The `.app` inside the `.zip` is the notarized build → updates apply with **no Gatekeeper reprompt**.
- Roll back by re-pointing `latest-mac.yml` at an older (still-present) version, or `--force` re-releasing.

**How an update reaches users** — electron-updater checks + downloads in the background on launch (and every ~6h), but the swap **applies on the next Cubic restart** (never mid-run) → a non-blocking "restart to update" banner. The AE panel rides **inside** the `.app`, so app + backend + panel travel together; on the post-update launch `provisionBridge()` re-copies the panel **only if it changed** (content hash), and only then is the user nudged to restart After Effects (detected by a panel build-id mismatch).

| Time | What happens | User sees |
|---|---|---|
| You ship | `npm run dist` + `npm run release` → R2 | nothing |
| User's Cubic, next launch/check | downloads the new version in the background | keeps working |
| Download done | update staged (not applied) | "Update ready — Restart now" (non-blocking) |
| User restarts Cubic | new version applies; `provisionBridge` re-copies the panel *iff* it changed | "Restart After Effects to finish" (only if the panel changed) |
| User restarts AE | new panel loads, reconnects | back to work |
