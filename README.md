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
    webcam.ts               # 1프레임 JPEG 캡처
    system-instruction.ts   # 페르소나 → 시스템 프롬프트
  data.ts                   # 3 페르소나 (토스 PM / 카카오 BE / 네이버 PD)
_design/                    # 원본 Claude Design 핸드오프 번들
```

## 동작 흐름

1. `PreInterview`에서 페르소나 자소서·회사 정보·검증할 명제 표시 → "면접 시작하기" 클릭
2. `Interview` 마운트 시 `useLiveSession.connect()` → Worker `/api/live-token` 호출 → ephemeral token 받음
3. 클라이언트가 `wss://generativelanguage.googleapis.com/ws/.../BidiGenerateContentConstrained?access_token=...` 로 WebSocket 연결
4. Setup envelope 전송 (model, systemInstruction, ko-KR speechConfig, in/out audio transcription)
5. `setupComplete` 수신 → 첫 질문 트리거를 위해 `realtimeInput.text` 짧게 한 번 전송
6. 서버가 24kHz PCM 오디오 청크와 outputTranscription 텍스트를 동시에 스트리밍 → 클라이언트가 음성 재생 + 텍스트를 Q 카드에 흘려 표시
7. 사용자가 "답변 시작" 클릭 → webcam 1프레임 캡처 + 마이크를 16kHz PCM으로 스트리밍 시작
8. "답변 종료" 클릭 → mic 종료 → 자동 VAD가 발화 종료 감지 → 서버가 다음 질문 생성 → 6번으로 루프
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
- ephemeral token: `uses=1`, 30분 만료. 한 세션이 30분을 넘기면 끊김.
- 한국어 voice 품질은 Live API preview 모델(`gemini-3.1-flash-live-preview`)에 의존.

## 5/1 데모 시나리오

페르소나 셋 중 하나를 선택 → 면접 시작 → 5턴 (baseline → probe-evidence → probe-thinking → tension → closing) 진행 → Results에서 latency·전체 transcript 확인. mock fallback 없음, 장애 시 재시도.

자세한 설계·검토 기록은 `.omc/specs/deep-interview-llm-integration.md` (gitignored). 핸드오프 디자인 번들은 `_design/` 참조.
