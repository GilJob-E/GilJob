# src/hooks — Live API Invariants

이 폴더는 Gemini Live API와의 WebSocket 세션을 다룬다. 코드 고치기 전에 반드시 아래 invariant를 알아야 한다. 어기면 1007 / 1006 / 답변 hang.

## 절대 위반 금지 invariant

### 1. text input + manual activity = 1007 (모든 메서드)

세션에 `realtimeInput.text`를 한 번이라도 보낸 후 `activityStart`/`activityEnd`를 보내면 (또는 그 반대) 서버가 1007 Precondition fail로 close. **Constrained 전용이라 알려졌으나 5/8 실증으로 Unconstrained도 동일 확인됨**.

→ 한 세션은 **하나의 입력 모드만** 선택:
- text 모드: `sendText`만 사용 (auto-VAD 모드, hybrid path)
- manual VAD 모드: `sendKickoff` + `startTurn`/`endTurn`의 activityStart/End만 사용 (Path B)

mixing 절대 X.

### 2. Constrained 메서드는 manual VAD 자체 거부 (Path A 사망 증거)

`BidiGenerateContentConstrained` (v1alpha + ephemeral token 경로)는 manual activity 마커를 거부 → 1007. text 입력 없이 빈 activityStart/End 페어만 보내도 마찬가지. (PR #4/#5 → #7 revert 기록)

→ manual VAD 원하면 **Unconstrained 메서드 (`v1beta.BidiGenerateContent`) + API key 직접 인증** 필수. Worker가 server-side에서 API key 들고 outbound WS 열고 client는 worker proxy로 접속.

### 3. Worker WS proxy 통한 인증 분리

Path B 아키텍처:
```
Browser ←→ /api/live-ws (worker) ←→ wss://generativelanguage.../v1beta.BidiGenerateContent?key=<API_KEY>
```

- Client는 **API key 알 필요 X** — worker URL만 알면 됨
- Worker secret `GEMINI_API_KEY`만 사용 (`worker/index.ts:108-157`의 `mintLiveToken`은 hybrid backward compat용으로 유지, Path B에선 호출 안 함)
- Same-origin gate (`worker/index.ts:67-72`)로 외부 스크래퍼 차단

### 4. systemInstruction은 자동 트리거 X — sendKickoff 필수

systemInstruction 마지막 줄 ("면접을 시작하면 짧은 인사 + 첫 번째 질문을 음성으로 전달하세요") 만으로 모델이 자동 발화 X. **사용자 turn 이벤트가 와야 모델이 응답**.

→ `sendKickoff` 함수가 **zero-content user turn** 시뮬레이션:
- `activityStart` 송신
- 100ms 무음 PCM (3200 bytes zeros, 16kHz mono int16) 송신
- `activityEnd` 송신

**빈 페어 (audio 없음)는 거부**. 실제 audio bytes 필요.

### 5. Manual `activityStart`/`activityEnd`는 audio chunk와 짝이 맞아야 함

`startTurn` → `activityStart` 송신 + audio capture 시작 + video frame 1장
`endTurn` → `activityEnd` 송신 + audio capture 즉시 종료 (setTimeout 없음)
짝 안 맞으면 서버가 turn boundary 인식 못해 hang.

### 6. Constrained method는 ephemeral token에 lock-in (참고 — 현재는 Path B로 우회)

WebSocket URL이 `BidiGenerateContentConstrained?access_token=...` 패턴이면 ephemeral token + v1alpha 강제. **Unconstrained로 바꾸려면**:
- ❌ Client에 API key 노출 (보안 disaster, 절대 X)
- ✅ Worker가 server-side에서 API key 들고 proxy (현재 Path B 채택)

## 모델 버전 의존 동작 (재검증 트리거)

이 폴더 코드는 **`gemini-3.1-flash-live-preview`**에서 검증됨 (2026-05-08). 다음 변경은 전체 검증 재수행 의무화:

- `useLiveSession.ts`의 hard-coded `model: 'models/gemini-3.1-flash-live-preview'` 변경
- `wrangler.toml`의 `GEMINI_LIVE_MODEL` env 추가 (현재 worker default와 일치하지만 stale 주석 cleanup 진행 중)
- 모델 deprecate → 자동 다운그레이드
- v1alpha/v1beta → 다른 API version 마이그레이션

검증 항목:
- `sendKickoff` 후 첫 발화 자동 emit (~1-3초)
- 1007 fail 발생 X
- 답변 종료 후 응답 latency <500ms (P50) / <1200ms (P95)

## 비밀번호 / 시크릿

- `GEMINI_API_KEY`는 `wrangler secret`에만. 코드/git/로그에 절대 X.
- Path B는 client에 token 안 노출 — worker가 API key로 server-side 직접 인증.
- (참고) hybrid path의 `tokenData.token`은 ephemeral (30분, 1회 사용) — 로그 출력해도 큰 위험 X (만료 빠름)이지만 습관적 마스킹 권장.

## Build marker

`useLiveSession.ts:4`의 `console.log('[live build]', __BUILD_SHA__)` — Vite `define`이 빌드 시점 git short SHA 주입 (`vite.config.ts`). **manual bump 패턴 (예: `v11`) 사용 금지** — 5/7 revert 후 stale 마커가 남아 디버깅 혼란 야기한 사고 학습.

## 디버깅 시 자주 보는 시그널

| 콘솔 / 증상 | 원인 | 해결 |
|---|---|---|
| `1007 Precondition check failed` | text + manual activity 혼합 | sendText 호출 제거, sendKickoff 사용 |
| `1006` (즉시 close) | Worker WS handshake 실패 또는 outbound 연결 거부 | curl 테스트로 worker 응답 확인. Miniflare는 `fetch({Upgrade})` 거부 → `new WebSocket()` 사용 |
| `setupComplete` 안 옴 | upstream WS open 전 client setup envelope dropped | `worker/ws-bridge.ts`의 pendingToUpstream 버퍼 작동 확인 |
| 무한 "세션 준비, 첫 질문 대기 중…" | sendKickoff 누락 또는 audio 없는 빈 activity 페어 | sendKickoff에 100ms 무음 audio 포함 확인 |
| 답변 종료 후 응답 영원히 안 옴 | activityEnd 안 갔거나 WS close | endTurn에서 ws.send 확인 |
| Frame index out of bounds (warn) | SpatialReal SDK cold load 정상 동작 | 무시 (해롭지 않음) |
| 27초 콜드 스타트 | live-preview 모델 first-session 정상 범위 | 정상 (1-3초 cold start + 모델 load 시 더) |
| Console outputTranscript chunk 도배 | 매 streaming chunk마다 [live] 로그 | 5/8 fix됨 (handleServerMessage에서 hasTranscript 트리거 제거) |
