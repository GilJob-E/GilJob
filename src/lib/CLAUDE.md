# src/lib — Utility Library Invariants

오디오·웹캠·프롬프트 빌드 등 보조 라이브러리. **audio sample rate asymmetry**가 가장 잊기 쉬운 invariant.

## 절대 위반 금지 invariant

### 1. Audio sample rate asymmetry — input 16kHz, output 24kHz

Gemini Live API의 비대칭 요구사항:

| 방향 | Sample rate | Format | 출처 |
|---|---|---|---|
| **Client → Gemini (mic)** | **16000 Hz** | mono PCM 16-bit | `audio-capture.ts`, `useLiveSession.ts:337` (`audio/pcm;rate=16000`) |
| **Gemini → Client (TTS)** | **24000 Hz** | mono PCM 16-bit | Gemini docs, `pcm-player.ts` (24kHz playback) |

→ `startAudioCapture`의 sample rate 16000 변경 X. `PCMPlayer`의 24000 변경 X. SpatialReal 통합도 24kHz output에 의존 (`SpatialAvatar.tsx:107`의 `audioFormat: { channelCount: 1, sampleRate: 24000 }`).

24kHz로 통일하려고 하면 mic stream이 Gemini에서 거부되거나 음질 저하. 16kHz로 통일하면 SpatialReal/PCMPlayer가 high pitch로 재생.

### 2. Webcam single-frame-per-turn 패턴

`webcam.ts:captureWebcamJpeg`은 **턴 시작 시 1장만** 캡처. 연속 video stream 아님. `useLiveSession.ts:startTurn`에서 호출 → `realtimeInput.video` 한 번 송신 → 그 턴 끝까지 추가 video 송신 X.

→ continuous video stream 시도 X (Gemini Live는 single-frame 디자인). N-frame 확장은 별도 follow-up issue로 평가됨 (`.omc/plans/...`).

### 3. PCM base64 인코딩은 8-bit boundary 정확

`pcm.ts:base64ToArrayBuffer`는 PCM 16-bit little-endian → base64 ↔ ArrayBuffer 변환. **byte 단위 정확** (16-bit sample = 2 byte, base64 4 char = 3 byte). chunking 시 16-bit 경계 안 맞으면 high-pitched 노이즈.

→ chunk size를 임의로 자르지 X. SDK가 보내는 chunk size 그대로 forward (보통 ~1.6KB = ~80ms @ 24kHz).

### 4. systemInstruction은 persona-driven, kickoff 트리거 의존성

`system-instruction.ts:buildSystemInstruction`은 `Persona` 객체에서 빌드. **마지막 줄**:
```
면접을 시작하면 짧은 인사 + 첫 번째 질문(baseline 워밍업)을 음성으로 전달하세요.
```

이 줄은 **advisory text** — Gemini Constrained 메서드에서는 이 텍스트만으로 자동 트리거 X. `Interview.tsx`의 kickoff useEffect가 `sendText`로 user turn을 시뮬레이션해야 모델이 발화 시작.

→ Path B (Worker WS proxy → Unconstrained) 마이그레이션 시 이 동작 변할 수 있음. 자동 트리거 가능해질 수도 있고, `sendEmptyTurn` 패턴 필요할 수도. **재검증 필수**.

자세한 내용은 `.omc/plans/manual-vad-migration.md` (Path A 사망 evidence) + `.omc/plans/worker-ws-proxy-b-option.md` (Path B 계획).

## 모델 변경 시 재검증 트리거

다음 중 하나라도 발생하면 이 폴더 invariant 재검증:

- `gemini-3.1-flash-live-preview` 변경/deprecate
- Gemini Live API method (Constrained ↔ Unconstrained) 전환
- SpatialReal SDK output format 변경

## 디버깅 시 자주 보는 시그널

| 콘솔/현상 | 원인 | 해결 |
|---|---|---|
| TTS 발음이 high-pitched | sample rate 불일치 (16kHz output을 24kHz로 재생 등) | invariant 1 점검 |
| Mic stream rejected by Gemini | 16kHz 외 sample rate 송신 | `startAudioCapture` 설정 확인 |
| Webcam frame 누락 | `captureWebcamJpeg`이 mount 직후가 아니라 turn 직후 호출되는데 카메라 권한 거부 | 권한 prompt 확인 + SVG fallback |
| 첫 발화 자동 트리거 안 됨 (Path B 시도 중) | systemInstruction의 advisory text는 트리거 X | kickoff 메커니즘 재설계 (`sendEmptyTurn` 등) |

## 추가 lib 파일

- `pcm-player.ts` — ring buffer 기반 PCM 재생. SpatialReal 모드에서는 `useLiveSession.ts`의 `onPcmChunk` callback이 PCMPlayer를 bypass (echo 방지).
- `personas.ts` (있다면) — Persona 데이터 정의. `Persona` interface는 `src/types.ts:21`에 정의.
- `audio-capture.ts` — `MediaRecorder` 래핑. 1-shot start/stop API 제공 (`captureRef.current?.stop()`).
