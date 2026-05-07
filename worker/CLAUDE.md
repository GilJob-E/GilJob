# worker — Cloudflare Workers Edge Runtime Invariants

이 폴더는 Cloudflare Workers 위에서 도는 백엔드. 정적 자산 서빙 + `/api/*` 엔드포인트. 아래 invariant 지켜라.

## 절대 위반 금지 invariant

### 1. `/api/*`는 same-origin gate 통과해야 함

`isAllowedOrigin(req)`이 모든 `/api/live-token` / `/api/avatarkit-token` 호출에서 `Origin` 헤더를 화이트리스트와 대조한다. 이걸 우회하면 외부 페이지가 token을 스크랩해서 Gemini quota / SpatialReal credit을 무단으로 소진할 수 있다.

- 새 `/api/*` 엔드포인트가 token mint를 한다면 **반드시** `isAllowedOrigin` 게이트 통과시킴.
- `DEMO_MODE`는 보안 토글 **X**. mintLiveToken 응답 형식만 바꿈 (placeholder vs real). origin 가드는 항상 strict (5/1 commit `c28d7a1`).
- 새 도메인을 추가할 때 ALLOWED Set 갱신 + production deploy 후 즉시 검증.

### 2. API key는 worker secret에만

- `GEMINI_API_KEY` / `SPATIALREAL_API_KEY` / `SPATIALREAL_SESSION_TOKEN` 등은 `wrangler secret put`으로만 등록.
- `wrangler.toml`의 `[vars]`에는 비밀 아닌 값만 (예: `DEMO_MODE`).
- 코드에서 fallback default 값으로 secret을 박지 말 것 (예: `env.GEMINI_API_KEY ?? 'sk-...'` 절대 금지).
- 응답으로 API key를 client에 절대 reveal X. ephemeral token만 client로 나간다.

### 3. Ephemeral token 구조는 Live API와 정확히 맞춰야 함

`mintLiveToken`이 발급하는 token은:
- `v1alpha/auth_tokens` 엔드포인트 사용 (다른 API 버전과 토큰 호환 X)
- `uses=1`, `newSessionExpireTime=60s`, `expireTime=30min`
- 응답의 `name` 필드가 client가 사용할 token (`access_token=` query param)

이 4개 중 하나라도 바꾸면 client 측 useLiveSession.ts의 `BidiGenerateContentConstrained` 호환성 깨질 수 있음. 특히 v1alpha → 다른 버전 시 client URL도 동시 변경 필수.

### 4. Workers Static Assets + SPA fallback 무결성 유지

`wrangler.toml`:
```toml
[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

이게 SPA 라우팅의 핵심. 임의로 `not_found_handling`을 끄거나 자산 디렉토리를 바꾸면 React Router가 새로고침 시 깨짐. 변경 시 production에서 deep-link (예: `/results`) 새로고침으로 검증 필요.

## Cloudflare Access는 prod에 걸지 마라 (학교 데모)

이 프로젝트는 무인증 데모를 전제. 5/6 누군가 (사용자 본인) Cloudflare Zero Trust Application을 추가했다가 5/7 삭제 (Account ID `dcdb09dbed5350bb28bcdc7a8d2a25a5`). same-origin gate + ephemeral token으로 attack surface가 충분히 작아서 Access는 over-engineering.

→ 다시 추가하기 전에 진짜 위협 모델 정의해라. 무한정 quota 소진 가능한 새 백엔드를 추가하기 전엔 안 켜도 됨.

## 디버깅 시 자주 보는 시그널

| 응답 | 원인 | 해결 |
|---|---|---|
| 302 → `cloudflareaccess.com` | Zero Trust Access 활성 | dashboard 또는 cloudflare-api MCP로 Application 삭제 |
| `403 forbidden` from `/api/*` | Origin 헤더 missing 또는 unlisted | 도메인 ALLOWED Set 갱신 후 재배포 |
| `503 GEMINI_API_KEY not set` | secret 미등록 | `wrangler secret put GEMINI_API_KEY` |
| `503 SpatialReal env missing` | SpatialReal secret 3개 중 하나 missing | `wrangler secret put SPATIALREAL_*` 모두 확인 |
| `502 token mint failed` | Gemini API 측 거부 | API key 만료/quota/region 확인 (`gh run view --log-failed` 도움 X, worker log 봐야) |

## Deploy / CI

- main push → `.github/workflows/deploy.yaml`이 typecheck → build → wrangler deploy 수행 (~2-3분)
- secret 변경은 wrangler CLI로만, repo에 영향 없음 (re-deploy 불필요, 다음 fetch부터 적용)
- production URL: `https://giljob-e.bjacaun.workers.dev`
