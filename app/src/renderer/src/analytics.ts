/**
 * No-op analytics seam (§C "Instrument event seams"). Call sites stay in place now so we don't
 * retrofit later; the vendor + distinct_id + flags get wired in a later pass. Does nothing today.
 */
export function track(event: string, props?: Record<string, unknown>): void {
  void event
  void props
}
