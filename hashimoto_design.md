# Hashimoto 엔진 통합 설계 문서

**브랜치**: `feature/hashimoto-integration`  
**작성일**: 2026-05-18  
**상태**: PR 준비 완료

---

## 1. 개요

Hashimoto는 GilJob의 외부 Python FastAPI 분석 엔진입니다. 지원자의 각 답변을 분석하여 다음 질문의 논리적 방향 — 논리 목표, 공백, 면접관 의도, 포커스, 톤 — 을 GilJob의 Gemini Live 세션에 동적으로 주입합니다.

**핵심 아이디어**: 매 지원자 답변 후 Hashimoto가 생성한 전략을 Gemini의 `systemInstruction`에 포함시켜 재연결하면, 다음 Gemini 턴은 그 전략을 최우선으로 반영해 질문을 생성합니다.

---

## 2. 시스템 구조

### 2-1. 기존 GilJob 구조 (통합 전)

```
브라우저 (React)
  └─ Interview.tsx
       ├─ buildSystemInstruction(persona)  ← 정적, 한 번만 생성
       └─ useLiveSession → Worker /api/live-ws → Gemini Live API
```

- `systemInstruction`은 마운트 시 한 번 생성, 이후 고정
- Gemini는 persona의 질문 흐름(`questions[].tone`)만 기반으로 질문 생성

### 2-2. 통합 후 구조

```
브라우저 (React)
  └─ Interview.tsx
       ├─ hashimotoInit(persona.resume)
       │    └─ Worker /api/hashimoto/init → Python FastAPI /init
       │
       ├─ [지원자 답변 종료마다]
       │    hashimotoProcessTurn(sttText, transcript)
       │         └─ Worker /api/hashimoto/process_turn → Python FastAPI /process_turn
       │              └─ HashimotoStrategy 반환
       │                   └─ setHashimotoStrategy(strategy)
       │                        └─ [useEffect] disconnect → connect
       │                             └─ buildSystemInstruction(persona, strategy, history)
       │                                  └─ 새 Gemini 세션에 전략 주입됨
       │
       └─ useLiveSession → Worker /api/live-ws → Gemini Live API
```

---

## 3. 파일별 변경 내역

### `src/types.ts`

`HashimotoStrategy` 인터페이스 추가. Python FastAPI의 `SapienStrategyPackage.interaction_strategy` 구조를 미러링.

```ts
interface HashimotoStrategy {
  logic_goal: string;
  logical_gap_to_bridge: string;
  interviewer_persona_guidance: {
    intent: string;
    emotion_direction: string;  // 톤 (Analytical_Pressure | Neutral_Curious | Supportive | Skeptical_Professional)
    focus_point: string;
  };
  current_context: {
    topic: string;
    depth_level: number;        // 0~5
    topic_changed: boolean;
    transition_hint: string | null;   // 'direction_change' | null
    multimodal_feedback_requirement: string | null;
  };
}
```

### `worker/index.ts`

두 개의 프록시 엔드포인트 추가:

| 엔드포인트 | 메서드 | 역할 |
|---|---|---|
| `/api/hashimoto/init` | POST | 이력서 텍스트로 세션 초기화 |
| `/api/hashimoto/process_turn` | POST | 지원자 답변 분석 → 전략 반환 |

`proxyHashimoto()` 함수는 `HASHIMOTO_API_URL` 환경변수(기본값 `http://localhost:8000`)로 요청을 포워딩합니다. Hashimoto 서버가 없으면 502 반환 — 클라이언트는 이를 non-fatal로 처리합니다.

**보안 주의**: `/api/hashimoto/*` 는 기존 엔드포인트와 동일하게 `isAllowedOrigin` 게이트를 통과합니다 (`worker/CLAUDE.md` 불변 #1 준수).

### `src/lib/system-instruction.ts`

`buildSystemInstruction(persona, strategy?, history?)` 로 시그니처 확장.

| 인자 조합 | 생성되는 systemInstruction |
|---|---|
| `(persona)` | 기존 정적 텍스트 + Hashimoto 논리 원칙 (하위 호환) |
| `(persona, strategy)` | 동적 전략 섹션 (논리 목표·공백·의도·포커스·톤 포함) |
| `(persona, strategy, history)` | 동적 전략 + 이전 대화 기록 (재연결 후 컨텍스트 복원) |

`history` 주입 시 `interviewerDone` 카운트로 다음 질문 턴 인덱스를 계산하여 "지금 해야 할 것"을 명시합니다.

### `src/components/Interview.tsx`

주요 상태 추가:

| 상태 | 역할 |
|---|---|
| `hashimotoStrategy` | 최신 전략 (null = 미도착) |
| `hashimotoAnalyzing` | 분석 중 플래그 → 답변 버튼 비활성화 |
| `hashimotoReady` | init 성공 여부 |
| `hashimotoTurnCount` | 전략 수신 횟수 |

`hashimotoProcessTurn` 콜백 흐름:

1. `setHashimotoAnalyzing(true)` → 버튼 비활성화, UI에 "Hashimoto 전략 분석 중…" 표시
2. `fetch('/api/hashimoto/process_turn', ...)` 호출
3. 전략 수신 → `transcriptLatestRef.current = nextTranscript`
4. `setHashimotoStrategy(strategy)` → `systemInstruction` memo 재계산 트리거
5. `reconnectNeededRef.current = true`
6. **다음 useEffect 커밋 후** `disconnect() → connect()` 실행
7. 재연결 완료 → `session.state === 'ready'` → `setHashimotoAnalyzing(false)` → 버튼 재활성화

---

## 4. 핵심 설계 결정 사항

### 4-1. 재연결 타이밍: queueMicrotask 아닌 useEffect 사용 이유

**문제**: 전략 도착 후 즉시 `queueMicrotask(() => disconnect(); connect())`를 호출하면, React가 `hashimotoStrategy` 상태 변경을 아직 커밋하지 않은 상태이므로 `useLiveSession`의 `optsRef.current.systemInstruction`이 구 버전 그대로입니다. 결과: Gemini는 새 전략 없이 연결됨 (7-턴 버그의 원인).

**해결**: `reconnectNeededRef.current = true`를 설정한 뒤, `hashimotoStrategy`를 deps로 하는 `useEffect` 안에서 재연결합니다. `useEffect`는 React 커밋 후 실행되므로 `optsRef`에 새 `systemInstruction`이 반영된 상태입니다.

```ts
useEffect(() => {
  if (!reconnectNeededRef.current) return;
  reconnectNeededRef.current = false;
  sessionRef.current?.disconnect();
  void sessionRef.current?.connect();
}, [hashimotoStrategy]);
```

### 4-2. 재연결 후 kickoff 방지

재연결 후 `session.state`가 `'ready'`로 돌아와도 `kickoffSentRef.current === true`이면 kickoff를 재전송하지 않습니다. 면접은 중단 없이 이어집니다.

### 4-3. Non-fatal 설계

Hashimoto 서버가 없거나 응답이 실패해도:
- `hashimotoInit` 실패 → `hashimotoReady = false` 유지, 면접 정상 진행
- `hashimotoProcessTurn` 실패 → catch 블록에서 `setHashimotoAnalyzing(false)`, 재연결 없음, 면접 정상 진행
- Gemini는 `strategy = undefined` 상태의 기존 systemInstruction으로 계속 동작

### 4-4. Worker proxy 패턴 선택 이유

Hashimoto API 키가 필요할 경우를 대비해 클라이언트에 직접 연결하지 않고 Worker가 프록시합니다. `HASHIMOTO_API_URL`을 Worker secret으로 관리하면 향후 인증 추가도 Worker 레벨에서 처리 가능합니다.

---

## 5. 환경 설정

### 로컬 개발

`.dev.vars` 파일에 추가 (git에 커밋하지 않음):

```
GEMINI_API_KEY=<your-key>
HASHIMOTO_API_URL=http://localhost:8000
```

`wrangler.toml [vars]`에는 비밀이 아닌 값만 (현재: `DEMO_MODE`, `HASHIMOTO_API_URL` localhost 기본값).

### 프로덕션 배포

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put HASHIMOTO_API_URL   # https://your-hashimoto-domain.com
```

Hashimoto 서버가 없는 경우 `HASHIMOTO_API_URL`을 설정하지 않으면 Worker가 `http://localhost:8000`으로 시도하다 502를 반환 — 클라이언트는 non-fatal로 처리합니다.

---

## 6. HashimotoPanel (디버그 UI)

`debugVisible === true` 일 때만 렌더링됩니다 (프로덕션에서도 사용자가 토글 가능).

| 상태 | 표시 |
|---|---|
| IDLE | 초기화 중… |
| READY | 첫 번째 답변 후 분석이 시작됩니다 |
| ANALYZING | 깜빡이는 점 + 스켈레톤 shimmer |
| TURN N | 전략 전체: 주제·깊이·상태 배지·논리 목표·공백·의도·포커스·톤 배지 |

**톤 색상 코딩**:
- `Analytical_Pressure` → 빨강 (`#ef4444`)
- `Neutral_Curious` → 파랑 (`#3b82f6`)
- `Supportive` → 초록 (`#22c55e`)
- `Skeptical_Professional` → 황색 (`#f59e0b`)

---

## 7. 알려진 제한 및 TODO

| 항목 | 우선도 | 설명 |
|---|---|---|
| Zod 검증 없음 | P1 | `as HashimotoStrategy` TypeScript 캐스트. 런타임 검증 없음. Zod 스키마 추가 필요. |
| Worker proxy 에러 응답 sanitize | P1 | `proxyHashimoto`가 Python 에러 본문(스택 트레이스 포함)을 그대로 전달. `errJson()`으로 교체 필요. |
| 포트 불일치 (8787/8788) | P1 | `vite.config.ts` 8788 vs `isAllowedOrigin` 8787. 로컬 dev에서 hashimoto 엔드포인트 403. 수정 필요. |
| hashimotoAnalyzing 고착 버그 | P2 | `connect()` 실패 시 `hashimotoAnalyzing === true`로 영구 고착. `session.state === 'error'` 조건 추가 필요. |
| anxiety/confidence 하드코딩 | P3 | `process_turn` 요청에 `anxiety: 50, confidence: 50` 고정. 향후 실제 측정값으로 교체 예정. |
| HASHIMOTO_API_URL 검증 없음 | P2 | Worker에서 URL 유효성 검사 없음. SSRF 벡터 가능성. HTTPS 강제 검증 추가 권장. |
| 테스트 없음 | P2 | `buildSystemInstruction`, `proxyHashimoto`, `hashimotoProcessTurn` 에 대한 단위/통합 테스트 없음. |

---

## 8. 변경된 파일 요약

```
src/types.ts                  — HashimotoStrategy 인터페이스 추가
src/lib/system-instruction.ts — buildSystemInstruction 시그니처 확장 (strategy, history)
src/components/Interview.tsx  — Hashimoto 통합 + HashimotoPanel UI
worker/index.ts               — /api/hashimoto/* 프록시 엔드포인트
wrangler.toml                 — DEMO_MODE=false, HASHIMOTO_API_URL 로컬 기본값
src/App.tsx                   — avatarStyle 기본값 'spatialreal' → 'illustration' (SpatialReal 크레딧 절약)
vite.config.ts                — proxy 포트 8787 → 8788 (TODO: isAllowedOrigin 동기화 필요)
package.json                  — wrangler v3.84 → v4.90 (major bump)
```

---

## 9. 테스트 방법

```bash
# 1. Hashimoto Python 서버 실행 (별도 레포)
uvicorn main:app --reload --port 8000

# 2. GilJob Worker 실행 (GEMINI_API_KEY는 .dev.vars에)
wrangler dev

# 3. Vite dev server
npm run dev

# 4. 브라우저에서 면접 시작 후 답변 → 디버그 패널 확인
# HashimotoPanel이 ANALYZING → TURN 1 → TURN 2 ... 로 변하면 정상
```

Hashimoto 서버 없이도 면접은 정상 동작합니다 (전략 없이 기존 persona 기반으로 진행).
