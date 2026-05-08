# src/hooks — Live API Invariants

This folder owns the WebSocket session against the Gemini Live API. Read every invariant below before touching the code. Violating them produces 1007 / 1006 closes or hung answers.

## Non-negotiable invariants

### 1. text input + manual activity = 1007 (every method)

Once a session has sent `realtimeInput.text`, sending `activityStart` / `activityEnd` (or the reverse order) closes the WS with 1007 Precondition fail. **Documented as Constrained-only, but empirically observed on Unconstrained too (5/8 evidence).**

→ A session must pick **one input mode**:
- text mode: `sendText` only (auto-VAD, hybrid path)
- manual VAD mode: `sendKickoff` + `startTurn` / `endTurn` `activityStart` / `activityEnd` (Path B)

Never mix.

### 2. Constrained refuses manual VAD outright (Path A death evidence)

`BidiGenerateContentConstrained` (v1alpha + ephemeral-token path) refuses manual activity markers → 1007. Even a bare `activityStart` / `activityEnd` pair without any text input gets the same treatment. (PR #4 / #5 → #7 revert is the receipt.)

→ Manual VAD requires the **Unconstrained method (`v1beta.BidiGenerateContent`) authenticated with an API key directly**. The worker holds the API key, opens the outbound WS server-side, and the client connects via the worker proxy.

### 3. Worker WS proxy splits the auth boundary

Path B architecture:

```
Browser ←→ /api/live-ws (worker) ←→ wss://generativelanguage.../v1beta.BidiGenerateContent?key=<API_KEY>
```

- Client never needs the API key — only the worker URL.
- Worker uses the `GEMINI_API_KEY` secret (`worker/index.ts:108-157` `mintLiveToken` is kept for hybrid backward compat only and is not invoked by Path B).
- Same-origin gate (`worker/index.ts:67-72`) blocks external scrapers.

### 4. systemInstruction does NOT auto-trigger — `sendKickoff` is required

The last line of systemInstruction ("면접을 시작하면 짧은 인사 + 첫 번째 질문을 음성으로 전달하세요") is not enough on its own to make the model speak. **A user-turn event must arrive before the model responds.**

→ `sendKickoff` simulates a **zero-content user turn**:
- send `activityStart`
- send 100ms silent PCM (3200 bytes of zeros, 16kHz mono int16)
- send `activityEnd`

**An empty pair (no audio) is rejected.** Real audio bytes are required.

### 5. Manual `activityStart` / `activityEnd` must be paired with audio chunks

`startTurn` → `activityStart` send + audio capture start + first video frame
`endTurn` → `activityEnd` send + immediate audio capture stop (no `setTimeout`)

A pair mismatch makes the server fail to recognize the turn boundary and the answer hangs.

### 6. Constrained method is locked to ephemeral tokens (kept for reference — Path B sidesteps this)

If the WebSocket URL is `BidiGenerateContentConstrained?access_token=...`, you're locked into Constrained + v1alpha. Switching to Unconstrained means either:

- ❌ Exposing the API key to the client (security disaster, never)
- ✅ Worker proxies server-side with the API key (Path B, current)

### 7. 1 fps video setInterval lifecycle — `clearVideoInterval` from 5 paths

`useLiveSession.ts:startTurn` opens a 1 fps video setInterval (`videoIntervalRef.current = setInterval(captureAndSendFrame, 1000)`) during a manual VAD turn (gated behind `import.meta.env.VITE_N_FRAME_LOOP_ENABLED !== '0'`). The interval **must** be cleared from every cleanup path or frames leak into the next turn or after the session ends:

- `endTurn` — first action, **before** the `activityEnd` send (so no stray frame slips past the boundary)
- `disconnect` — first action
- `ws.onerror` — before `setError`
- `ws.onclose` — before `cleanupTurnAudio`
- `useEffect` cleanup — transitively, via `disconnect`

`clearVideoInterval` is idempotent: callable twice with no error, sets `videoIntervalRef.current = null` (not just `clearInterval`-and-leave), and resets `framesSentRef.current = 0` so the per-turn counter does not bleed across turns. DEV asserts at all 5 sites verify the ref was actually nulled.

Telemetry: `outputTranscription` is accumulated per turn against `VISUAL_ACK_PATTERN = /(표정|자세|끄덕|손짓|편안|긴장|변화|미소)/`; on `turnComplete` we log `[live] visual-ack: <bool> rate: <x>/<y>`. The phrase list is the locked source of truth shared by `.omc/specs/deep-interview-n-frame.md`, `.omc/plans/n-frame-multi-frame.md`, `.omc/spikes/n-frame-spike-2026-05-08.md`, and README "Deferred verifications". Changing it requires synchronized updates across all five.

→ Kill switch: `import.meta.env.VITE_N_FRAME_LOOP_ENABLED='0'` skips the setInterval entirely → original single-frame behavior. Production fallback without a code revert (Cloudflare env change + rebuild).

→ Skipping any cleanup path leaks frames between turns or after disconnect, confuses the model, and wastes tokens.

## Model-version-dependent behavior (re-validation triggers)

Code in this folder is verified against **`gemini-3.1-flash-live-preview`** (2026-05-08). Any of the following requires re-running the full verification:

- The hard-coded `model: 'models/gemini-3.1-flash-live-preview'` in `useLiveSession.ts` changes
- `wrangler.toml` adds a `GEMINI_LIVE_MODEL` env (currently matches the worker default; stale comments are being cleaned up)
- The model is deprecated → auto-downgrade
- v1alpha / v1beta → some other API version migration

Verification checklist:

- First utterance auto-emits ~1-3s after `sendKickoff`
- No 1007 closes
- Post-answer response latency <500ms (P50) / <1200ms (P95)

## Secrets

- `GEMINI_API_KEY` lives in `wrangler secret` and only there. Never in code, git, or logs.
- Path B never exposes a token to the client — the worker authenticates server-side with the API key.
- (Aside) hybrid path's `tokenData.token` is ephemeral (30 min, single-use) — logging it isn't catastrophic (expires quickly), but mask it as a habit.

## Build marker

`useLiveSession.ts:4`'s `console.log('[live build]', __BUILD_SHA__)` — Vite `define` injects the git short SHA at build time (`vite.config.ts`). **Don't use a manual bump pattern (e.g. `v11`)** — after the 5/7 revert a stale marker survived and made debugging harder. Lesson learned.

## Common debugging signals

| Console / symptom | Cause | Fix |
|---|---|---|
| `1007 Precondition check failed` | text + manual activity mixed | Remove the `sendText` call; use `sendKickoff` |
| `1006` (immediate close) | Worker WS handshake failed or outbound rejected | `curl` the worker; in Miniflare use `new WebSocket()` (the `fetch({Upgrade})` pattern is rejected) |
| `setupComplete` never arrives | Client setup envelope dropped before upstream WS opened | Verify the `pendingToUpstream` buffer in `worker/ws-bridge.ts` |
| Stuck on "세션 준비, 첫 질문 대기 중…" | Missing `sendKickoff` or empty activity pair (no audio) | Confirm `sendKickoff` sends 100ms silent audio |
| No response after `endTurn` | `activityEnd` didn't go out, or WS closed | Check the `ws.send` in `endTurn` |
| `Frame index out of bounds` (warn) | SpatialReal SDK cold-load normal | Ignore (harmless) |
| 27s cold start | live-preview model first-session normal range | Normal (1-3s baseline cold start; first-ever model load adds more) |
| Console flooded with `outputTranscript` chunks | Old `[live]` log fired on every streaming chunk | Fixed 5/8 (the `hasTranscript` trigger was removed from `handleServerMessage`) |
| Frames leak after a turn ends | `clearVideoInterval` skipped on a cleanup path | Verify all 5 paths (endTurn / disconnect / ws.onerror / ws.onclose / useEffect via disconnect); DEV asserts will surface the offender |
