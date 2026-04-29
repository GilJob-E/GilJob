# CLAUDE.md

이 파일은 Claude Code가 이 레포에서 작업할 때 따라야 할 컨벤션을 정의합니다.

## Stack

- **Frontend**: React + TypeScript + Vite (SPA)
- **Routing**: `react-router` v7 — **library mode**로만 사용 (framework mode 금지, 아래 참고)
- **Runtime**: Cloudflare Workers
  - 정적 자산: Workers Static Assets
  - 백엔드 API: 같은 Worker (단일 배포) 또는 별도 Worker
- **Database**: Cloudflare D1 (SQLite, DB당 ≤ 10GB)
- **Queue**: Cloudflare Queues — `Worker A → Queue → Worker B` 패턴
- **Email**: Cloudflare Email Service (송수신 모두)

## Development

- 이 레포는 **Claude Code**로 개발한다. 이 문서는 Claude Code의 작업 가이드.
- 모델 / effort 기본값: `opus`, `effort max`
- **subagent + git worktree**로 작업을 병렬화 — main TUI가 블로킹되지 않게 한다.

## Memory

- 현재는 로컬 마크다운 파일로 관리. 별도 벡터 DB / 메모리 서비스 도입 금지.

## Do NOT

- **Next.js 금지** — Vercel-편향 빌드, OpenNext 어댑터 시차, supply chain 리스크. React + Vite로 처리.
- **React Router v7 framework mode 금지** — SPA로 충분. 향후 SSR이 정말 필요해지면 재검토 (그땐 Next.js 대신 React Router framework mode + CF Vite plugin).
- **Cloudflare Workers AI LoRA fine-tune 금지** — latency 30s+ / 불안정. 외부 LLM API 사용.
- **로컬 통합 테스트 환경 구축 금지** — non-local-first 원칙 (아래 참고).
- **Vercel / Vercel 의존 패키지 도입 금지** (`@vercel/*` 등).

## Workflow (non-local-first)

1. Claude Code로 코드 작성
2. `/verify`만 실행 (단위 테스트 · 타입 체크 · 린트)
3. **수동 로컬 실행 안 함** → 바로 PR 또는 push
4. GH Actions(`deploy.yaml`)이 `test → typecheck → build → wrangler deploy` 수행 (2–3분)
5. dev / staging에서 눈으로 확인

배포 대기 중에 다른 작업 진행한다.

## CI / Deploy

- 자격증명은 `.env`의 `GH_API_KEY` 사용.
- 배포·디버깅은 `wrangler` + `gh` CLI만으로 처리한다 (대시보드 클릭 금지).
- CI 실패 시: `gh run view <run-id> --log-failed`로 로그 확인 후 수정.

## Commands

| 목적 | 명령 |
|---|---|
| 로컬 실행 (디버깅 한정) | `wrangler dev` |
| 수동 배포 | `wrangler deploy` |
| D1 마이그레이션 | `wrangler d1 migrations apply <DB>` |
| CI 상태 | `gh run list --limit 5` |
| CI 실패 로그 | `gh run view <id> --log-failed` |
| 시크릿 등록 | `wrangler secret put <NAME>` |

## Conventions

- 모든 신규 인프라는 **Cloudflare 우선** 검토. 외부 SaaS 도입은 CF에 동등 기능이 없을 때만.
- 환경변수·시크릿은 `wrangler secret put`으로 등록. 코드/레포에 평문 금지.
- 큐 컨슈머는 **멱등성(idempotent)** 보장 — 재시도 시 부작용 없어야 함.
- API 요청/응답은 **Zod schema**로 검증. 클라/서버 모두 타입 일관.
- React 컴포넌트는 **함수형 + hooks**만 사용. class component 금지.