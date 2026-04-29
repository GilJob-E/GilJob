/**
 * GilJob-E Worker — single deploy, serves SPA + /api/live-token.
 *
 * Frontend gets a one-shot ephemeral token here, then opens a WebSocket
 * directly to Gemini Live API. Worker never proxies the WebSocket itself,
 * keeping the cloud bridge thin.
 *
 * Required secret: GEMINI_API_KEY (wrangler secret put GEMINI_API_KEY)
 *
 * For pre-API smoke (no key set), DEMO_MODE=true short-circuits live-token
 * with a placeholder so the SPA still loads end-to-end.
 */

export interface Env {
  ASSETS: Fetcher;
  DEMO_MODE: string;
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string; // override default; otherwise gemini-3.1-flash-live-preview
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const errJson = (msg: string, status = 500) => json({ ok: false, error: msg }, status);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, env, url);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    switch (url.pathname) {
      case '/api/health':
        return json({
          ok: true,
          demo: env.DEMO_MODE === 'true',
          hasGeminiKey: !!env.GEMINI_API_KEY,
          model: env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview',
          ts: new Date().toISOString(),
        });
      case '/api/live-token':
        if (req.method !== 'POST') return errJson('POST required', 405);
        return mintLiveToken(env);
      default:
        return errJson('not found', 404);
    }
  } catch (e) {
    return errJson((e as Error).message);
  }
}

/**
 * Mint a Gemini Live API ephemeral token.
 *
 * Live API accepts the token via `?access_token=<name>` query param on the
 * WebSocket URL OR via `Authorization: Token <name>` header.
 *
 * Defaults:
 *   - uses: 1 (single-use)
 *   - newSessionExpireTime: 60s (must connect within a minute)
 *   - expireTime: 30 minutes (max session length)
 */
async function mintLiveToken(env: Env): Promise<Response> {
  if (env.DEMO_MODE === 'true' && !env.GEMINI_API_KEY) {
    return json({
      ok: true,
      demo: true,
      token: 'DEMO_TOKEN_NO_REAL_API',
      model: 'gemini-3.1-flash-live-preview',
      expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  }

  if (!env.GEMINI_API_KEY) return errJson('GEMINI_API_KEY not set', 503);

  const now = Date.now();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();

  // v1alpha/auth_tokens (Live API preview) currently only honors `?key=` query
  // param auth, not `x-goog-api-key` header. Trade: key briefly in outbound URL
  // (Worker fetch doesn't log URLs by default; add no logging that captures it).
  const tokenRes = await fetch(
    `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uses: 1,
        newSessionExpireTime,
        expireTime,
      }),
    },
  );

  if (!tokenRes.ok) {
    // Sanitize: Google error bodies can echo request metadata. Log internally,
    // return a generic message to the client.
    const detail = await tokenRes.text().catch(() => '');
    console.error('gemini auth_tokens failed', tokenRes.status, detail.slice(0, 500));
    return errJson('token mint failed', 502);
  }

  const data = (await tokenRes.json()) as { name: string; expireTime: string };
  return json({
    ok: true,
    demo: false,
    token: data.name,
    model: env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview',
    expireTime: data.expireTime,
  });
}
