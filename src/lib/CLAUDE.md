# src/lib — Utility Library Invariants

Audio, webcam, and prompt-build helpers live here. The **audio sample-rate asymmetry** is the easiest invariant to forget.

## Non-negotiable invariants

### 1. Audio sample rate asymmetry — input 16kHz, output 24kHz

Gemini Live API's asymmetric requirement:

| Direction | Sample rate | Format | Source |
|---|---|---|---|
| **Client → Gemini (mic)** | **16000 Hz** | mono PCM 16-bit | `audio-capture.ts`, `useLiveSession.ts` mic send (`audio/pcm;rate=16000`) |
| **Gemini → Client (TTS)** | **24000 Hz** | mono PCM 16-bit | Gemini docs, `pcm-player.ts` (24kHz playback) |

→ Don't change `startAudioCapture`'s 16000. Don't change `PCMPlayer`'s 24000. SpatialReal integration also depends on the 24kHz output (`SpatialAvatar.tsx:107` `audioFormat: { channelCount: 1, sampleRate: 24000 }`).

Unifying everything to 24kHz makes Gemini reject the mic stream or degrades quality. Unifying to 16kHz makes SpatialReal / PCMPlayer play back high-pitched.

### 2. Webcam multi-frame stream — 1 fps during turn

`webcam.ts:captureWebcamJpeg` is a single-frame capture function. **`useLiveSession.ts:startTurn` calls it on a 1-second `setInterval` for the duration of the answer**, forming a multi-frame stream. Each frame is an independent `realtimeInput.video` message.

The vendor design (Gemini Live `realtimeInput.video`) is a 1 fps multi-frame stream — the implementation matches. Frequencies above 1 fps are undocumented; do not attempt them. The manual VAD path is also vendor-undocumented territory, so the spike (`.omc/spikes/n-frame-spike-2026-05-08.md`) confirmed motivation via SPIKE-0 PASS before adoption. SPIKE-1 (audio+video 2-min cap behavior) and SPIKE-2 (mid-turn frame attribution paired evidence) were **deferred** to production observation by user decision — `visualAckSeenRef` ratio + kill switch + 24h rollback gate are the safety net (see `.omc/plans/n-frame-multi-frame.md` and README "Deferred verifications" for full context).

→ The `setInterval` MUST be cleared from all 5 cleanup paths in `useLiveSession.ts`: `endTurn` / `disconnect` / `ws.onerror` / `ws.onclose` / `useEffect`. A leak bleeds frames into the next turn.

→ Kill switch: setting `import.meta.env.VITE_N_FRAME_LOOP_ENABLED='0'` falls back to single-frame behavior in production (Cloudflare env change + rebuild, no code revert).

### 3. PCM base64 encoding is byte-exact on 8-bit boundaries

`pcm.ts:base64ToArrayBuffer` converts PCM 16-bit little-endian ↔ base64 ↔ ArrayBuffer. **Byte-exact** (16-bit sample = 2 bytes; 4 base64 chars = 3 bytes). If a chunk is sliced off-boundary, you get high-pitched noise.

→ Don't slice chunks arbitrarily. Forward whatever the SDK sends (typically ~1.6KB ≈ ~80ms @ 24kHz).

### 4. systemInstruction is persona-driven and depends on a kickoff trigger

`system-instruction.ts:buildSystemInstruction` builds from the `Persona` object. The **last line**:

```
면접을 시작하면 짧은 인사 + 첫 번째 질문(baseline 워밍업)을 음성으로 전달하세요.
```

is **advisory text** — under Gemini's Constrained method this text alone does not auto-trigger anything. `Interview.tsx`'s kickoff `useEffect` has to simulate a user turn (`sendText` for hybrid, `sendKickoff` for Path B) before the model speaks.

→ When the Live API method or transport changes, this behavior may shift (auto-trigger may become possible, or a different `sendEmptyTurn`-style pattern may be required). **Re-validate.**

See `.omc/plans/manual-vad-migration.md` (Path A death evidence) and `.omc/plans/worker-ws-proxy-b-option.md` (Path B plan) for the full back-story.

## Re-validation triggers on model changes

Any of these triggers re-validation of every invariant in this folder:

- `gemini-3.1-flash-live-preview` is changed or deprecated
- Switching between Gemini Live methods (Constrained ↔ Unconstrained)
- SpatialReal SDK output format changes

## Common debugging signals

| Console / symptom | Cause | Fix |
|---|---|---|
| TTS sounds high-pitched | Sample-rate mismatch (e.g. 16kHz output played as 24kHz) | Check invariant 1 |
| Mic stream rejected by Gemini | Sample rate other than 16kHz | Check `startAudioCapture` config |
| Webcam frame missing | `captureWebcamJpeg` is called after mount instead of right after the turn starts and the camera permission was denied | Verify the permission prompt + SVG fallback. Also confirm `setInterval` actually fires (kill switch may have disabled it) |
| First-utterance auto-trigger fails (Path B mid-migration) | systemInstruction's advisory text doesn't trigger anything | Redesign the kickoff (e.g. `sendEmptyTurn`) |

## Other lib files

- `pcm-player.ts` — ring-buffer-based PCM playback. In SpatialReal mode `useLiveSession.ts`'s `onPcmChunk` callback bypasses `PCMPlayer` (echo prevention).
- `personas.ts` (if present) — Persona data. The `Persona` interface lives in `src/types.ts:21`.
- `audio-capture.ts` — `MediaRecorder` wrapper. One-shot start/stop API (`captureRef.current?.stop()`).
