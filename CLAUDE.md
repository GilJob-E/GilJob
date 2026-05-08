# CLAUDE.md

This file defines the conventions Claude Code must follow when working in this repo.

## Stack

- **Frontend**: React + TypeScript + Vite (SPA)
- **Routing**: `react-router` v7 — **library mode only** (framework mode prohibited; see Do NOT below)
- **Runtime**: Cloudflare Workers
  - Static assets: Workers Static Assets
  - Backend API: same Worker (single deploy) or a separate Worker
- **Database**: Cloudflare D1 (SQLite, ≤ 10GB per DB)
- **Queue**: Cloudflare Queues — `Worker A → Queue → Worker B` pattern
- **Email**: Cloudflare Email Service (send and receive)

## Development

- This repo is built with **Claude Code**. This document is the working guide for Claude Code.
- Default model / effort: `opus`, `effort max`.
- Parallelize with **subagent + git worktree** so the main TUI never blocks.

## Memory

- Currently managed via local markdown files. Do NOT introduce a separate vector DB or memory service.

## Do NOT

- **No Next.js** — Vercel-biased build, OpenNext adapter lag, supply-chain risk. Use React + Vite.
- **No React Router v7 framework mode** — SPA is enough. If SSR ever becomes a real need, revisit (and prefer React Router framework mode + the CF Vite plugin over Next.js).
- **No Cloudflare Workers AI LoRA fine-tune** — latency 30s+ and unstable. Use an external LLM API.
- **No local integration test environment** — non-local-first principle (see Workflow).
- **No Vercel or Vercel-dependent packages** (`@vercel/*` etc.).

## Workflow (non-local-first)

1. Write code with Claude Code.
2. Run `/verify` only (unit tests · type-check · lint).
3. **Skip manual local execution** → straight to PR or push.
4. GH Actions (`deploy.yaml`) runs `test → typecheck → build → wrangler deploy` (~2-3 min).
5. Eyeball verify on dev / staging.

Pick up other work while the deploy runs.

## CI / Deploy

- Use `GH_API_KEY` from `.env` for credentials.
- Deploy and debug via `wrangler` + `gh` CLI only (no dashboard clicks).
- On CI failure: `gh run view <run-id> --log-failed` to inspect, then fix.

## Commands

| Purpose | Command |
|---|---|
| Local run (debugging only) | `wrangler dev` |
| Manual deploy | `wrangler deploy` |
| D1 migration | `wrangler d1 migrations apply <DB>` |
| CI status | `gh run list --limit 5` |
| CI failure logs | `gh run view <id> --log-failed` |
| Register secret | `wrangler secret put <NAME>` |

## Conventions

- New infrastructure goes through **Cloudflare-first** evaluation. Reach for external SaaS only when CF lacks an equivalent.
- Env vars and secrets: register via `wrangler secret put`. No plaintext in code or repo.
- Queue consumers must be **idempotent** — retries cannot produce side effects.
- Validate API request/response with **Zod schemas** on both client and server.
- React components are **functional + hooks only**. No class components.

## Live API turn-end architecture (current as of 2026-05-08)

Production main is on **Path B** (manual VAD via Worker WS proxy → Gemini Unconstrained), shipped in PR #8 / `e5aa88d`. The `feat/n-frame-video-stream` branch adds a 1 fps multi-frame video stream during turns (commits `775bba4`, `a9a0b1d` — Day 3 verification + PR pending).

- **Path B (production)**: client → worker `/api/live-ws` → Gemini `BidiGenerateContent` (v1beta + API key). `automaticActivityDetection: { disabled: true }` + `activityStart` / `activityEnd`. Worker holds `GEMINI_API_KEY`; the client never sees a token.
- **Hybrid (deprecated)**: `BidiGenerateContentConstrained` (v1alpha + ephemeral token) + auto-VAD + 1.5s mic tail. `mintLiveToken` (`/api/live-token`) is retained only for backward compat and is not exercised by the current client.

Core invariants (memorize or pay later):

1. **text + manual activity = 1007 (every method)** — once a session has sent `realtimeInput.text`, sending `activityStart` / `activityEnd` (or vice versa) closes the WS with 1007 Precondition fail. This was thought to be Constrained-only but holds on Unconstrained too. In a manual-VAD session, never call `sendText`. Use `sendKickoff` (zero-content user turn = activityStart + 100ms silent PCM + activityEnd) instead.
2. **Constrained refuses manual VAD outright** — the ephemeral-token path forces Constrained, which 1007s on any manual activity marker. To use manual VAD you need Unconstrained, which means the worker holds the API key and proxies the WS server-side.
3. **Miniflare (`wrangler dev`) rejects outbound `fetch({ Upgrade: 'websocket' })`** — must use `new WebSocket()` (works in both production CF runtime and Miniflare).
4. **Worker WS bridge must buffer client→upstream messages** — if the client setup envelope arrives before the upstream socket opens, it is dropped. Queue into `pendingToUpstream` and drain on `upstream.open`.

For the full invariant set + debugging signals, see `src/hooks/CLAUDE.md` and `worker/CLAUDE.md`.
