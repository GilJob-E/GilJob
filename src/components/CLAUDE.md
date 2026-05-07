# src/components — UI Component Invariants

이 폴더는 React UI 컴포넌트. 대부분 generic React이지만 **SpatialAvatar.tsx**는 5/1 demo에서 hot-fix 5개를 거치며 학습한 invariant가 다수. 그 부분만 강조.

## SpatialAvatar.tsx — 절대 위반 금지 invariant

### 1. `controller.start()` resolve로 ready 판단 X — `onConnectionState === 'connected'`만 신뢰

`AvatarSDK`의 `controller.start()` Promise는 WebSocket 세션이 실제 connected가 되기 전에 resolve된다. 이 사이에 audio chunk를 보내면 SDK가 "Session not configured yet, skipping audio send" 로그 후 **fallback mode로 영구 진입** — 이후 모든 animation 무시. 5/1 demo 직전에 발견 (commit `e73db0e`).

→ `startedRef.current = true` 설정은 반드시 `view.controller.onConnectionState` 콜백에서 `state === 'connected'`인 시점만. `start()` resolve 직후 X.

### 2. PCM ring buffer (PENDING_MAX=200)는 cold-start 첫 턴 방지용 — 절대 제거 금지

SDK init이 1-3초 걸리는 동안 도착한 audio chunk를 잃으면 **첫 면접관 발화가 무음**으로 들림. ring buffer가 init 중 chunk를 누적해두고 `connected` 시점에 drain.

→ `pendingChunksRef`/`PENDING_MAX` 제거 X. 200은 ~24kHz @ 80ms chunk 기준 ~5초 audio = 충분 + safety.

### 3. SDK는 lazy import — `vite.config.ts`의 `command === 'serve'` 분기로 production bundle 격리

`@spatialwalk/avatarkit`는 ~6.5MB raw / ~3-4MB gzip. 평소 production bundle (1-2MB)에 들어가면 안 됨. 그래서:
- `import('@spatialwalk/avatarkit')` 동적 import로 lazy load
- `vite.config.ts`에서 `avatarkitVitePlugin` + `rollupOptions.external` 조건부 적용
- spike route (`?spike=1`)에서만 SDK가 DEV bundle에 포함

→ `import` 정적으로 바꾸거나 `external` 제거 X. production bundle 폭증 = 모바일 사용자 데이터 비용 폭탄.

### 4. Audio context init은 user gesture 직후에만

`view.controller.initializeAudioContext()`는 브라우저 user gesture 윈도우 내에서만 작동. 현재는 mount 직후 호출 → "면접 시작" 클릭 직후 mount되므로 OK이지만 **fragile**. multiple `await` 후 호출하면 gesture window 닫힘 → AudioContext 거부.

→ follow-up TODO: `PreInterview.tsx`의 "면접 시작" onClick 핸들러로 lift-up. `useEffect` 안의 await chain 늘리지 X.

### 5. 인증은 ephemeral session token만 — API key 절대 client에 X

`/api/avatarkit-token`이 worker에 저장된 24h session token을 반환. SpatialReal API key는 worker secret에 격리. SDK의 `setSessionToken`만 사용.

→ client 코드에 API key 박지 X (Phase A vendor mint 도입 시에도 동일).

## 모델 변경 시 재검증 트리거

SpatialReal SDK 변경이 다음을 수반하면 **이 폴더 전체 재검증**:
- `@spatialwalk/avatarkit` major bump
- 음성 sample rate 24000 외 변경
- 인증 방식 변경 (Phase A vendor mint endpoint)

검증 항목:
- 첫 턴 audio 누락 없음 (ring buffer)
- fallback mode 영구 진입 없음 (connection-state 게이트)
- production bundle <1MB (lazy import)

## 다른 컴포넌트

`Interview.tsx`, `PreInterview.tsx`, `Results.tsx`, `Avatar.tsx` (SVG fallback) — generic React. 특별 invariant 없음. 단:

- `Interview.tsx`의 kickoff useEffect는 Path B에선 `session.sendKickoff()` 사용 (zero-content user turn = activityStart + 100ms 무음 PCM + activityEnd). hybrid path는 `session.sendText('면접을 시작하겠습니다...')` 사용. **mixing 절대 X — text + manual activity = 1007 close** (Constrained/Unconstrained 둘 다). Live API 메서드 변경 시 재검증.
- `Avatar.tsx`는 SpatialAvatar fallback 옵션. `avatarStyle: 'illustration' | 'orb' | 'geometric' | 'initial'` 분기. 추가 시 `src/types.ts`의 `AvatarStyle` union도 확장.

## 디버깅 시 자주 보는 시그널 (SpatialReal 기준)

| 콘솔 | 원인 | 해결 |
|---|---|---|
| `Empty animation data received - enabling fallback mode` | start() resolve와 connection-state 사이 audio 송신 | invariant 1 위반, 코드 확인 |
| `Frame index 999 out of bounds` (warn) | SDK cold load 정상 동작 | 무시 (해롭지 않음) |
| `insufficient credits (-9/10)` | SpatialReal 50분 free credit 소진 | dashboard 충전 또는 SVG fallback (`avatarStyle = 'illustration'`) |
| 첫 발화 무음 | ring buffer drain 실패 또는 `startedRef` race | invariant 2 + invariant 1 동시 점검 |
