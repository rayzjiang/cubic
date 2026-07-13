// Shared destructive-action button styling — a muted warm coral-red (Claude-style), NOT the default
// bright RGB red. Single source of truth so the "nice red" stays identical across every destructive
// button (delete account, cancel plan, delete chat). Tune the hex here to restyle them all at once.
export const DANGER_BTN =
  'rounded-md bg-[#d65a53] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#c44f48]'

// The grayed-out, unclickable variant (e.g. Delete account while a subscription must be cancelled first).
export const DANGER_BTN_DISABLED =
  'rounded-md bg-white/10 px-3 py-1.5 text-[13px] font-medium text-white/35 cursor-not-allowed'
