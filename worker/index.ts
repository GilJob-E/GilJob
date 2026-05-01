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
  // SpatialReal AvatarKit (3D 면접관 아바타) — Phase B 통합
  SPATIALREAL_APP_ID?: string;
  SPATIALREAL_API_KEY?: string; // reserved for vendor mint endpoint (Phase A)
  SPATIALREAL_AVATAR_ID?: string;
  SPATIALREAL_SESSION_TOKEN?: string;
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

/**
 * Same-origin gate for `/api/*` endpoints.
 *
 * Both `/api/live-token` and `/api/avatarkit-token` mint short-lived tokens
 * that an attacker could scrape to drain Gemini quota or SpatialReal credits.
 * Browsers send `Origin` automatically and cannot forge it from a third-party
 * page; non-browser scrapers can spoof it but at least raise the bar.
 *
 * For dev (`wrangler dev`), allow no Origin header (curl from terminal during
 * development). Production rejects empty Origin to force browser-class clients.
 */
function isAllowedOrigin(req: Request, env: Env): boolean {
  const origin = req.headers.get('origin');
  // Dev convenience: when DEMO_MODE is true (typical of local wrangler dev),
  // empty origin is acceptable so manual curl smoke tests still work.
  if (!origin) return env.DEMO_MODE === 'true';
  const ALLOWED = new Set([
    'https://giljob-e.bjacaun.workers.dev',
    'http://localhost:5173', // vite dev
    'http://localhost:8787', // wrangler dev
  ]);
  return ALLOWED.has(origin);
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  try {
    // Token-mint endpoints require an allow-listed Origin to keep public
    // scrapers out of the Gemini / SpatialReal billing surface.
    if (url.pathname === '/api/live-token' || url.pathname === '/api/avatarkit-token') {
      if (!isAllowedOrigin(req, env)) return errJson('forbidden', 403);
    }
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
      case '/api/avatarkit-token':
        if (req.method !== 'POST') return errJson('POST required', 405);
        return mintAvatarKitToken(env);
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

/**
 * Mint a SpatialReal AvatarKit session token for the client.
 *
 * Phase B (current): vendor mint endpoint API spec is undocumented as of
 * 2026-05-01. This handler returns the manually-rotated session token stored
 * via `wrangler secret put SPATIALREAL_SESSION_TOKEN` (max 1h validity).
 * Operators must rotate the secret every ~50 minutes during demo sessions.
 *
 * Phase A (TBD): when SpatialReal publishes the `/sessions` mint endpoint,
 * this function will exchange `SPATIALREAL_API_KEY` + `SPATIALREAL_APP_ID`
 * for a fresh server-side token, removing the manual rotation requirement.
 *
 * Response shape mirrors the Gemini token endpoint for symmetry. App ID and
 * Avatar ID are not secrets per vendor docs but are routed through the
 * worker so the client only needs one fetch and so all SpatialReal config
 * lives behind the same auth boundary.
 */
async function mintAvatarKitToken(env: Env): Promise<Response> {
  const appId = env.SPATIALREAL_APP_ID;
  const avatarId = env.SPATIALREAL_AVATAR_ID;
  const sessionToken = env.SPATIALREAL_SESSION_TOKEN;
  if (!appId || !avatarId || !sessionToken) {
    return errJson(
      'SpatialReal env missing — set SPATIALREAL_APP_ID / SPATIALREAL_AVATAR_ID / SPATIALREAL_SESSION_TOKEN via `wrangler secret put`',
      503,
    );
  }
  return json({
    ok: true,
    appId,
    avatarId,
    sessionToken,
    // Phase B: token is manually rotated, so we can't authoritatively report
    // remaining validity. Client treats this as a hint only.
    expiresIn: 3600,
  });
}
