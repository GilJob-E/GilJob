# src/hooks — Live API Invariants

이 폴더는 Gemini Live API와의 WebSocket 세션을 다룬다. 코드를 고치기 전에 반드시 아래 invariant를 알아야 한다. 어기면 1007 Precondition fail 또는 면접 hang.

## 절대 위반 금지 invariant

### 1. Manual VAD + text input은 절대 같은 세션에 공존 X

`BidiGenerateContentConstrained` 메서드 (현재 사용 중) + `automaticActivityDetection: { disabled: true }` + `realtimeInput.text` 송신 = **WebSocket close 1007 "Precondition check failed"**. 즉시 turn 죽음.

따라서:
- `sendText`는 **throw**한다 (`useLiveSession.ts:sendText`). 호출하는 코드가 추가되면 즉시 fail-fast로 알림.
- `realtimeInput: { text: ... }` 형태의 payload 송신 금지.
- 텍스트 입력 기능 추가가 필요하면 **B-option (worker WS proxy → Unconstrained method) 마이그레이션 선행**. 그 전에는 절대 추가 X.

### 2. Constrained method는 ephemeral token에 lock-in

WebSocket URL이 `BidiGenerateContentConstrained?access_token=...` 패턴인 이유: ephemeral token은 v1alpha auth_tokens endpoint에서 발급되고, v1alpha는 Constrained 메서드만 지원. **Unconstrained로 바꾸려면**:

- 클라가 worker로 WS 연결 → worker가 API key로 BidiGenerateContent (Unconstrained) 연결 (proxy 패턴)
- OR 클라에 API key 노출 (보안 disaster, 절대 X)

→ 현재 코드는 ephemeral token + Constrained 조합을 **신성불가침**으로 본다.

### 3. systemInstruction 알아서 첫 발화 트리거 X

서버는 user turn 이벤트가 와야 응답한다. 그래서 connect 직후 한번 `sendEmptyTurn` (빈 `activityStart`/`activityEnd` 페어)을 쏘아 zero-length 사용자 턴을 시뮬레이션한다. 이게 없으면 면접 시작 시 무한 hang ("세션 준비, 첫 질문 대기 중…").

→ `systemInstruction`을 단지 *내용*을 바꾸는 데 사용하라. 첫 발화 트리거 메커니즘을 systemInstruction에 의존하지 말 것.

### 4. Manual `activityStart`/`activityEnd`는 audio chunk와 짝이 맞아야 함

- `startTurn` → `activityStart` 송신 + audio capture 시작
- `endTurn` → `activityEnd` 송신 + audio capture 즉시 종료
- 짝 안 맞으면 서버가 turn boundary 인식 못해서 `thinking` 무한 hang

→ `activityStart`만 보내고 `activityEnd` 안 보내거나 그 반대 X.

## 모델 버전 의존 동작 (재검증 트리거)

이 폴더 코드는 **`gemini-3.1-flash-live-preview`**에서 검증됨 (2026-05-07). 다음 변경은 전체 검증 재수행 의무화:

- `wrangler.toml` / worker `GEMINI_LIVE_MODEL` 변경
- 모델 deprecate → 자동 다운그레이드
- v1alpha → 다른 API version 마이그레이션

검증 항목:
- `sendEmptyTurn` 후 첫 발화 자동 emit (~1-3초)
- 1007 fail 안 발생
- 답변 종료 후 응답 latency <500ms

## 비밀번호 / 시크릿

- API key는 `wrangler secret`에만. 코드/git/로그에 절대 X.
- `tokenData.token`은 ephemeral (30분, 1회 사용). 로그 출력해도 큰 위험 X (만료 빠름)이지만 습관적으로 마스킹 권장.

## 디버깅 시 자주 보는 시그널

| 콘솔 | 원인 | 해결 |
|---|---|---|
| `1007 Precondition check failed` | manual VAD + text 조합 | text 호출 제거 |
| 무한 "세션 준비, 첫 질문 대기 중…" | sendEmptyTurn 누락 또는 실패 | Interview.tsx kickoff useEffect 확인 |
| 답변 종료 후 응답 영원히 안 옴 | activityEnd 안 감 또는 WS close | endTurn에서 ws.send 확인 |
| Frame index out of bounds (warn) | SpatialReal SDK cold load 정상 동작 | 무시 (해롭지 않음) |
