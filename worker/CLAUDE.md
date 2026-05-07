# worker — Cloudflare Workers Edge Runtime Invariants

이 폴더는 Cloudflare Workers 위에서 도는 백엔드. 정적 자산 서빙 + `/api/*` 엔드포인트. 아래 invariant 지켜라.

## 절대 위반 금지 invariant

### 1. `/api/*` token-mint / WS-bridge는 same-origin gate 통과 필수

`isAllowedOrigin(req)`이 모든 `/api/live-token` / `/api/avatarkit-token` / `/api/live-ws` 호출에서 `Origin` 헤더를 화이트리스트와 대조한다. 우회 시 외부 페이지가 token 또는 WS 세션을 스크랩해서 Gemini quota / SpatialReal credit 무단 소진 가능.

- 새 `/api/*` 엔드포인트가 Gemini/SpatialReal 결제 surface에 닿으면 **반드시** `isAllowedOrigin` 게이트 통과시킴.
- `DEMO_MODE`는 보안 토글 X. mintLiveToken 응답 형식만 바꿈 (placeholder vs real). origin 가드는 항상 strict (5/1 commit `c28d7a1`).
- 새 도메인 추가 시 ALLOWED Set 갱신 + production deploy 후 즉시 검증.

### 2. API key는 worker secret에만

- `GEMINI_API_KEY` / `SPATIALREAL_API_KEY` / `SPATIALREAL_SESSION_TOKEN` 등은 `wrangler secret put`으로만 등록.
- `wrangler.toml`의 `[vars]`에는 비밀 아닌 값만 (예: `DEMO_MODE`).
- 코드에서 fallback default 값으로 secret을 박지 말 것 (예: `env.GEMINI_API_KEY ?? 'sk-...'` 절대 X).
- 응답으로 API key를 client에 절대 reveal X.

### 3. WS bridge는 `new WebSocket()` 사용 (Miniflare 호환)

`worker/ws-bridge.ts:handleWsBridge`가 outbound Gemini WS를 열 때 **`new WebSocket(upstreamUrl)` 사용**. `fetch({headers: {Upgrade: 'websocket'}})` 패턴은 Miniflare(local wrangler dev)이 거부 → `Fetch API cannot load: wss://...` 502.

- Production CF runtime + local Miniflare 둘 다 `new WebSocket()` 작동
- Trade-off: `allowHalfOpen: true` 옵션 사용 못 함 → close-frame 전파에서 약간의 race 가능 (실용적 영향 적음)
- 5/8 실증 (`day1-am-cf-workers-ws-2026-05-07.md` AM research에선 fetch 권장이라 했지만 local 한계로 변경)

### 4. WS bridge는 client→upstream 메시지 버퍼링 필수

`new WebSocket(upstreamUrl)`이 비동기 connect하는 동안 client setup envelope이 도착하면 dropped → setupComplete 영원히 안 옴 → "연결 대기 중" hang.

해결: `pendingToUpstream: (ArrayBuffer | string)[]` 큐로 누적. `upstream.addEventListener('open', ...)`에서 drain 후 정상 전달. Inbound (upstream→client)는 server.accept() 즉시 OPEN이라 버퍼링 불필요.

### 5. Ephemeral token vs API key 인증 분리

| Path | 인증 | 클라이언트 노출 | 서버 책임 |
|---|---|---|---|
| **hybrid (`/api/live-token`)** | Gemini ephemeral token (auth_tokens, 30분, uses=1) | client에 token 전달, client가 직접 Gemini WS | 토큰 mint만 |
| **Path B (`/api/live-ws`)** | API key (worker secret) | **client에 아무것도 전달 X** | server-side WS proxy |

- Hybrid `mintLiveToken`은 backward compat용으로 유지 (현재 사용 X — Path B 머지 후 follow-up에서 deprecate 평가)
- Path B에선 client는 worker URL만 알면 됨

### 6. Workers Static Assets + SPA fallback 무결성

`wrangler.toml`:
```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

이게 SPA 라우팅의 핵심. 임의로 `not_found_handling`을 끄거나 자산 디렉토리를 바꾸면 React Router 새로고침 시 깨짐. 변경 시 production에서 deep-link (예: `/results`) 새로고침으로 검증.

## Cloudflare Access는 prod에 걸지 마라 (학교 데모)

이 프로젝트는 무인증 데모 전제. 5/6 누군가 (사용자 본인) Cloudflare Zero Trust Application 추가했다가 5/7 삭제 (Account ID `dcdb09dbed5350bb28bcdc7a8d2a25a5`, Application ID `87e6c65c-...`). same-origin gate + ephemeral token으로 attack surface 충분히 작아서 Access는 over-engineering.

→ 다시 추가하기 전에 진짜 위협 모델 정의해라. 무한정 quota 소진 가능한 새 백엔드 추가하기 전엔 안 켜도 됨.

## 디버깅 시 자주 보는 시그널

| 응답 / 증상 | 원인 | 해결 |
|---|---|---|
| 302 → `cloudflareaccess.com` | Zero Trust Access 활성 | dashboard 또는 cloudflare-api MCP로 Application 삭제 |
| `403 forbidden` from `/api/*` | Origin 헤더 missing 또는 unlisted | 도메인 ALLOWED Set 갱신 후 재배포 |
| `503 GEMINI_API_KEY not set` | `.dev.vars` 또는 `wrangler secret put` 미등록 | 적절한 위치에 등록. local dev은 `.dev.vars`에 |
| `503 SpatialReal env missing` | SpatialReal secret 3개 중 하나 missing | `wrangler secret put SPATIALREAL_*` 모두 확인 |
| `502 Upstream connect failed: Fetch API cannot load: wss://...` | Miniflare가 outbound WS upgrade fetch 거부 | ws-bridge에서 `new WebSocket()` 사용 (이미 적용됨) |
| `502 token mint failed` | Gemini API 측 거부 | API key 만료/quota/region 확인 |
| WS 연결 후 setupComplete 안 옴 | upstream open 전 client message dropped | ws-bridge의 pendingToUpstream 버퍼 누락 의심 |
| 1007 close 직후 | 서버가 protocol violation 감지 | manual VAD + text input 혼합 또는 Constrained method에 manual activity 송신 |

## Endpoint 인벤토리

| Endpoint | 메서드 | 인증 | 책임 |
|---|---|---|---|
| `/api/health` | GET | open (no origin gate) | DEMO_MODE / model 노출 (digital health check) |
| `/api/live-token` | POST | same-origin | Gemini ephemeral token mint (hybrid path) |
| `/api/avatarkit-token` | POST | same-origin | SpatialReal session token 반환 (Phase B 수동 rotation) |
| `/api/live-ws` | GET (Upgrade: websocket) | same-origin | Path B WS proxy → Gemini Unconstrained |

## Deploy / CI

- main push → `.github/workflows/deploy.yaml`이 typecheck → build → wrangler deploy 수행 (~2-3분)
- secret 변경은 wrangler CLI로만, repo에 영향 없음 (re-deploy 불필요, 다음 fetch부터 적용)
- production URL: `https://giljob-e.bjacaun.workers.dev`
- spike branch 코드는 절대 main에 직접 push X — PR 통해서만 (5/7 사고 학습)
