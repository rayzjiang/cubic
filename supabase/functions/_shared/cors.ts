// Shared CORS headers + a small JSON response helper. The Electron renderer calls
// create-checkout/create-portal directly over HTTPS, so the functions answer
// CORS preflight. The webhook is called server-to-server by Stripe (no CORS).

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
