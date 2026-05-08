# src/components — UI Component Invariants

This folder holds React UI components. Most are generic React, but **SpatialAvatar.tsx** carries a stack of invariants learned from five hot-fixes around the 5/1 demo. Those are the ones to internalize.

## SpatialAvatar.tsx — non-negotiable invariants

### 1. `controller.start()` resolve does NOT mean ready — only `onConnectionState === 'connected'` is trustworthy

`AvatarSDK`'s `controller.start()` Promise resolves before the WebSocket session is actually connected. Audio chunks sent in the gap make the SDK log `"Session not configured yet, skipping audio send"` and **enter fallback mode permanently** — every animation after that is ignored. Found right before the 5/1 demo (commit `e73db0e`).

→ Set `startedRef.current = true` only inside the `view.controller.onConnectionState` callback when `state === 'connected'`. Never directly after `start()` resolves.

### 2. PCM ring buffer (`PENDING_MAX = 200`) prevents cold-start first-turn loss — do NOT remove

SDK init takes 1-3 seconds. Audio chunks arriving in that window are otherwise dropped, which makes **the first interviewer utterance come out silent**. The ring buffer accumulates chunks during init and drains them on `connected`.

→ Don't remove `pendingChunksRef` / `PENDING_MAX`. 200 covers ~5 seconds of audio at 24kHz / 80ms chunks — enough plus safety margin.

### 3. SDK is lazy-imported — `vite.config.ts` `command === 'serve'` branch isolates it from the production bundle

`@spatialwalk/avatarkit` is ~6.5MB raw / ~3-4MB gzipped. Pulling it into the normal production bundle (1-2MB) is unacceptable. So:

- `import('@spatialwalk/avatarkit')` is a dynamic import (lazy load).
- `vite.config.ts` applies `avatarkitVitePlugin` + `rollupOptions.external` conditionally.
- The SDK is included in the DEV bundle only on the spike route (`?spike=1`).

→ Don't switch the `import` to static, and don't remove `external`. Production-bundle bloat = data-cost grenade for mobile users.

### 4. AudioContext init must run inside the user-gesture window

`view.controller.initializeAudioContext()` only works inside the user-gesture window. Today it runs right after mount → mount happens immediately after the "면접 시작" click, so it works — but it's **fragile**. Adding more `await`s before the call closes the gesture window and the `AudioContext` is rejected.

→ Follow-up TODO: lift the init into the `PreInterview.tsx` "면접 시작" `onClick` handler. Don't lengthen the `await` chain inside the `useEffect`.

### 5. Auth is ephemeral session token only — no API key on the client, ever

`/api/avatarkit-token` returns the 24h SpatialReal session token stored in worker secrets. The SpatialReal API key never leaves the worker. The SDK only ever sees `setSessionToken`.

→ Never inline an API key in client code (the same rule applies if/when the Phase A vendor-mint endpoint lands).

## Re-validation triggers on SDK changes

Re-validate every invariant in this folder if any of the following change:

- `@spatialwalk/avatarkit` major bump
- Audio sample rate moves off 24000
- Auth scheme changes (e.g. Phase A vendor-mint endpoint)

Verify:

- No first-turn audio loss (ring buffer)
- No permanent fallback-mode entry (connection-state gate)
- Production bundle stays <1MB (lazy import)

## Other components

`Interview.tsx`, `PreInterview.tsx`, `Results.tsx`, `Avatar.tsx` (SVG fallback) — generic React. No specific invariants. Two notes:

- `Interview.tsx`'s kickoff `useEffect` uses `session.sendKickoff()` on Path B (zero-content user turn = activityStart + 100ms silent PCM + activityEnd). The hybrid path used `session.sendText('면접을 시작하겠습니다...')`. **Never mix — text + manual activity = 1007 close** on both Constrained and Unconstrained. Re-validate when the Live API method changes.
- `Avatar.tsx` is the SpatialAvatar fallback. `avatarStyle: 'illustration' | 'orb' | 'geometric' | 'initial'` branches. Adding a new style requires extending the `AvatarStyle` union in `src/types.ts`.

## Common debugging signals (SpatialReal-side)

| Console | Cause | Fix |
|---|---|---|
| `Empty animation data received - enabling fallback mode` | Audio sent between `start()` resolve and `connection-state === connected` | Invariant 1 violation; check the code |
| `Frame index 999 out of bounds` (warn) | SDK cold-load normal | Ignore (harmless) |
| `insufficient credits (-9/10)` | SpatialReal 50-min free credit drained | Top up via dashboard or fall back to SVG (`avatarStyle = 'illustration'`) |
| First utterance silent | Ring-buffer drain failed or `startedRef` race | Check invariants 1 + 2 together |
