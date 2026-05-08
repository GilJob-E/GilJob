# worker — Cloudflare Workers Edge Runtime Invariants

Backend served from Cloudflare Workers. Static assets + `/api/*` endpoints. Follow the invariants below.

## Non-negotiable invariants

### 1. `/api/*` token-mint and WS-bridge endpoints must pass the same-origin gate

`isAllowedOrigin(req)` checks the `Origin` header against a whitelist on every `/api/live-token`, `/api/avatarkit-token`, and `/api/live-ws` call. Bypassing this lets external pages scrape tokens or WS sessions and burn Gemini quota / SpatialReal credits.

- Any new `/api/*` endpoint that touches a Gemini or SpatialReal billing surface **must** go through `isAllowedOrigin`.
- `DEMO_MODE` is not a security toggle. It only changes `mintLiveToken`'s response shape (placeholder vs real). The origin gate is always strict (commit `c28d7a1`).
- When adding a new domain, update the `ALLOWED` set and re-verify in production immediately.

### 2. API keys live in worker secrets — only

- `GEMINI_API_KEY` / `SPATIALREAL_API_KEY` / `SPATIALREAL_SESSION_TOKEN` are registered exclusively via `wrangler secret put`.
- `wrangler.toml` `[vars]` only carries non-secret values (e.g. `DEMO_MODE`).
- Never inline a secret as a fallback default in code (e.g. `env.GEMINI_API_KEY ?? 'sk-...'` — never).
- Never reveal an API key to the client in any response.

### 3. WS bridge uses `new WebSocket()` (Miniflare-compatible)

`worker/ws-bridge.ts:handleWsBridge` opens the outbound Gemini WS via **`new WebSocket(upstreamUrl)`**. The `fetch({ headers: { Upgrade: 'websocket' } })` pattern is rejected by Miniflare (`wrangler dev`) → `Fetch API cannot load: wss://...` 502.

- `new WebSocket()` works in both production CF runtime and local Miniflare.
- Trade-off: `allowHalfOpen: true` is unavailable → minor races on close-frame propagation (rarely matters in practice).
- Validated 5/8 (the AM research note in `day1-am-cf-workers-ws-2026-05-07.md` recommended fetch, but the local-dev limitation forced the change).

### 4. WS bridge must buffer client→upstream messages

While `new WebSocket(upstreamUrl)` is connecting asynchronously, any client setup envelope that arrives is dropped → `setupComplete` never comes → "연결 대기 중" hang.

Fix: queue into `pendingToUpstream: (ArrayBuffer | string)[]` and drain inside `upstream.addEventListener('open', ...)`. The inbound direction (upstream → client) doesn't need buffering — `server.accept()` is OPEN immediately.

### 5. Ephemeral token vs API-key auth split

| Path | Auth | Client exposure | Server responsibility |
|---|---|---|---|
| **hybrid (`/api/live-token`)** | Gemini ephemeral token (auth_tokens, 30 min, single-use) | Client receives the token and connects directly to Gemini | Mint the token only |
| **Path B (`/api/live-ws`)** | API key (worker secret) | **Client receives nothing** | Server-side WS proxy |

- Hybrid `mintLiveToken` is kept for backward compat (currently unused — deprecation will be evaluated in a follow-up after Path B merges).
- Under Path B the client only needs to know the worker URL.

### 6. Workers Static Assets + SPA fallback integrity

`wrangler.toml`:

```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

This is the core of SPA routing. Disabling `not_found_handling` or moving the asset directory breaks React Router on hard refresh. After any change here, verify a deep-link refresh (e.g. `/results`) in production.

## Don't put Cloudflare Access on prod (school demo)

This project is unauthenticated by design. On 5/6 someone (you) added a Cloudflare Zero Trust Application; on 5/7 it was removed (Account ID `dcdb09dbed5350bb28bcdc7a8d2a25a5`, Application ID `87e6c65c-...`). The same-origin gate + ephemeral tokens already shrink the attack surface enough that Access is over-engineering.

→ Define a real threat model before adding it back. Don't enable it just because new endpoints exist — only when a backend can drain quota without bound.

## Common debugging signals

| Response / symptom | Cause | Fix |
|---|---|---|
| 302 → `cloudflareaccess.com` | Zero Trust Access enabled | Delete the Application via the dashboard or the cloudflare-api MCP |
| `403 forbidden` from `/api/*` | `Origin` header missing or unlisted | Update the `ALLOWED` set and redeploy |
| `503 GEMINI_API_KEY not set` | Not registered in `.dev.vars` or via `wrangler secret put` | Register in the right place; for local dev use `.dev.vars` |
| `503 SpatialReal env missing` | One of the 3 SpatialReal secrets missing | Verify all `wrangler secret put SPATIALREAL_*` |
| `502 Upstream connect failed: Fetch API cannot load: wss://...` | Miniflare refuses the outbound WS upgrade fetch | Use `new WebSocket()` in ws-bridge (already applied) |
| `502 token mint failed` | Gemini API rejected the request | Check API key expiry / quota / region |
| WS connects but `setupComplete` never arrives | Client message dropped before upstream open | Suspect a missing `pendingToUpstream` buffer in ws-bridge |
| 1007 close immediately | Server detected a protocol violation | Manual VAD + text input mixed, or manual activity sent on Constrained method |

## Endpoint inventory

| Endpoint | Method | Auth | Responsibility |
|---|---|---|---|
| `/api/health` | GET | open (no origin gate) | Expose `DEMO_MODE` / model (digital health check) |
| `/api/live-token` | POST | same-origin | Mint Gemini ephemeral token (hybrid path) |
| `/api/avatarkit-token` | POST | same-origin | Return SpatialReal session token (Phase B manual rotation) |
| `/api/live-ws` | GET (Upgrade: websocket) | same-origin | Path B WS proxy → Gemini Unconstrained |

## Deploy / CI

- A push to `main` triggers `.github/workflows/deploy.yaml` (typecheck → build → wrangler deploy, ~2-3 min).
- Secret changes go through the wrangler CLI only; the repo isn't affected (no redeploy needed — the next fetch picks them up).
- Production URL: `https://giljob-e.bjacaun.workers.dev`.
- Never push spike-branch code directly to main — only via PR (5/7 incident lesson).
