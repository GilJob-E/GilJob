# GilJob-E

면접 시뮬레이션 프로토타입. 자소서·회사·표정 한 프레임을 동시에 보고 다음 질문을 만드는 한국어 AI 면접관.

**Live**: https://giljob-e.bjacaun.workers.dev

## Stack

- React 18 + TypeScript + Vite (SPA)
- Cloudflare Workers (Static Assets + `/api/live-token`)
- Gemini Live API (WebSocket bidi, 16kHz PCM in / 24kHz PCM out, 한국어)
- AudioWorklet (mic 캡처 + PCM 다운샘플) · Web Audio API (스트리밍 재생)

핵심 구조: Worker는 ephemeral token 발급만 담당, 클라이언트는 토큰을 받아 Gemini Live API에 **직접** WebSocket 연결.

```
브라우저(getUserMedia + AudioWorklet) ──ws──> Gemini Live API
        │
        │ POST /api/live-token  (한 번)
        ▼
    Worker (GEMINI_API_KEY)  ──REST──> auth_tokens
```

## Quick start

```bash
git clone https://github.com/GilJob-E/GilJob.git
cd GilJob
npm install

# 1) Google AI Studio (https://aistudio.google.com/apikey) 에서 API 키 발급
# 2) production secret 등록 (interactive prompt)
wrangler secret put GEMINI_API_KEY

# 3) wrangler.toml 의 DEMO_MODE 를 "false" 로 바꾸고 배포
npm run deploy
```

로컬에서 돌려보려면 `.dev.vars` 에 `GEMINI_API_KEY=...` 한 줄을 두고 `npm run wrangler:dev`.

## Scripts

| 명령 | 용도 |
|---|---|
| `npm run dev` | Vite dev server (5173) — 단순 UI 작업용 |
| `npm run wrangler:dev` | Worker + 정적 자산 통합 dev (8787) — `/api/*` 포함 작업용 |
| `npm run build` | typecheck + Vite build → `dist/` |
| `npm run deploy` | build + `wrangler deploy` |

## 디렉토리

```
worker/index.ts             # /api/live-token, /api/health 핸들러
public/audio-capture-worklet.js  # 16kHz PCM 다운샘플 worklet
src/
  components/               # PreInterview, Interview, Results, Avatar
  hooks/useLiveSession.ts   # WebSocket 라이프사이클 + 메시지 라우팅
  lib/
    audio-capture.ts        # mic → 16kHz PCM
    pcm-player.ts           # 24kHz PCM gapless 재생
    pcm.ts                  # base64 ↔ Int16 변환
    webcam.ts               # JPEG 캡처 (1 fps multi-frame stream용)
    system-instruction.ts   # 페르소나 → 시스템 프롬프트
  data.ts                   # 3 페르소나 (토스 PM / 카카오 BE / 네이버 PD)
_design/                    # 원본 Claude Design 핸드오프 번들
```

## 동작 흐름

1. `PreInterview`에서 페르소나 자소서·회사 정보·검증할 명제 표시 → "면접 시작하기" 클릭
2. `Interview` 마운트 시 `useLiveSession.connect()` → Worker `/api/live-ws`로 same-origin WebSocket 연결
3. Worker가 server-side에서 `GEMINI_API_KEY`로 `wss://generativelanguage.googleapis.com/.../BidiGenerateContent?key=...` (Unconstrained, v1beta) 에 outbound WS 연결 후 양방향 proxy
4. Setup envelope 전송 (model, systemInstruction, ko-KR speechConfig, manual VAD `automaticActivityDetection: { disabled: true }`, in/out audio transcription)
5. `setupComplete` 수신 → `sendKickoff` (zero-content user turn: activityStart + 100ms 무음 PCM + activityEnd) 송신해 첫 질문 트리거
6. 서버가 24kHz PCM 오디오 청크와 outputTranscription 텍스트를 동시에 스트리밍 → 클라이언트가 음성 재생 + 텍스트를 Q 카드에 흘려 표시
7. 사용자가 "답변 시작" 클릭 → `activityStart` 송신 + 마이크를 16kHz PCM으로 스트리밍 시작 + webcam을 1초 간격으로 캡처해 multi-frame video stream 송신 (`VITE_N_FRAME_LOOP_ENABLED='0'`로 single-frame fallback)
8. "답변 종료" 클릭 → `activityEnd` 송신 + mic 즉시 종료 + video setInterval 정리 → 서버가 다음 질문 생성 → 6번으로 루프
9. 5턴 + closing 인사 후 `Results` 화면으로 자동 전환

## 환경 변수 / 시크릿

`wrangler.toml` (vars):
- `DEMO_MODE` — `"true"` 면 Worker가 GEMINI_API_KEY 없이도 mock 토큰 반환 (스모크 테스트용)

`wrangler secret put` 으로 등록:
- `GEMINI_API_KEY` (필수, 실제 Live API 호출용)
- `GEMINI_LIVE_MODEL` (선택, 기본 `gemini-3.1-flash-live-preview`)

## 알려진 제약

- 브라우저: Chrome/Edge 권장 (AudioWorklet + getUserMedia + WebSocket). Safari는 검증 안 됨.
- 마이크/웹캠 권한 거부 시: 마이크 거부면 답변 불가, 웹캠 거부면 비전 입력만 누락 (오디오/텍스트는 계속 동작).
- 네트워크 끊김 시: 자동 재연결 로직 없음. UI에 "재연결" 버튼 노출.
- 세션 길이: Gemini Live audio+video 세션 default cap = 2분 (vendor docs). 5턴 면접 누적이 cap에 닿을 가능성 — `Deferred verifications` SPIKE-1 항목 참조.
- 한국어 voice 품질은 Live API preview 모델(`gemini-3.1-flash-live-preview`)에 의존.

## 데모 흐름

페르소나 셋 중 하나를 선택 → 면접 시작 → 5턴 (baseline → probe-evidence → probe-thinking → tension → closing) 진행 → Results에서 latency·전체 transcript 확인. mock fallback 없음, 장애 시 재시도.

자세한 설계·검토 기록은 `.omc/specs/deep-interview-llm-integration.md` (gitignored). 핸드오프 디자인 번들은 `_design/` 참조.
