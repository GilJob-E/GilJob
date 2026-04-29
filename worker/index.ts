/**
 * GilJob-E Worker — single deploy, serves SPA + /api/* endpoints.
 *
 * In DEMO_MODE (default for 5/1 demo), API endpoints return mock JSON so the
 * frontend works end-to-end without external API keys. For real integration,
 * set `DEMO_MODE = "false"` in wrangler.toml and register secrets via
 *   wrangler secret put ANTHROPIC_API_KEY
 *   wrangler secret put GEMINI_API_KEY
 *   wrangler secret put ELEVENLABS_API_KEY
 *   wrangler secret put ELEVENLABS_VOICE_ID
 */

export interface Env {
  ASSETS: Fetcher;
  DEMO_MODE: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

const errJson = (msg: string, status = 500) =>
  json({ ok: false, error: msg }, status);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(req, env, url);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const demo = env.DEMO_MODE === 'true';

  try {
    switch (url.pathname) {
      case '/api/health':
        return json({ ok: true, demo, ts: new Date().toISOString() });
      case '/api/llm':
        return demo ? mockLlm(req) : realLlm(req, env);
      case '/api/vision':
        return demo ? mockVision(req) : realVision(req, env);
      case '/api/tts':
        return demo ? mockTts() : realTts(req, env);
      case '/api/stt':
        return demo ? mockStt(req) : realStt(req, env);
      default:
        return errJson('not found', 404);
    }
  } catch (e) {
    return errJson((e as Error).message);
  }
}

async function mockLlm(_req: Request) {
  return json({
    ok: true,
    text: '(mock LLM 응답) 자기소개와 관련해 한 가지만 더 여쭤보고 싶습니다. 그 결정에서 다르게 했다면 결과가 어떻게 달라졌을까요?',
    visionAdjusted: null,
  });
}

async function mockVision(_req: Request) {
  return json({
    ok: true,
    keywords: ['집중', '단정한 자세', '정면 응시'],
    confidence: 0.82,
  });
}

async function mockTts() {
  // 1-byte placeholder audio. Frontend plays nothing useful in demo mode.
  return new Response(new Uint8Array([0]), {
    headers: { 'content-type': 'audio/mpeg' },
  });
}

async function mockStt(_req: Request) {
  return json({
    ok: true,
    text: '(mock STT 결과) 네, 답변 드리겠습니다…',
  });
}

// --- Real API stubs (5/1 이후 채울 자리) ---

async function realLlm(_req: Request, env: Env) {
  if (!env.ANTHROPIC_API_KEY) return errJson('ANTHROPIC_API_KEY not set', 503);
  return errJson('not implemented (post-5/1)', 501);
}

async function realVision(_req: Request, env: Env) {
  if (!env.GEMINI_API_KEY) return errJson('GEMINI_API_KEY not set', 503);
  return errJson('not implemented (post-5/1)', 501);
}

async function realTts(_req: Request, env: Env) {
  if (!env.ELEVENLABS_API_KEY) return errJson('ELEVENLABS_API_KEY not set', 503);
  return errJson('not implemented (post-5/1)', 501);
}

async function realStt(_req: Request, _env: Env) {
  return errJson('not implemented (post-5/1)', 501);
}
