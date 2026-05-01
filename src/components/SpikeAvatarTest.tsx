/**
 * SpikeAvatarTest — feat/spatialreal-spike branch only.
 *
 * 면접관 아바타 시연용 phoneme test. 사용자 마이크 echo가 아니라,
 * Gemini Live가 페르소나의 첫 한국어 질문을 발화하고, 그 24kHz PCM 스트림을
 * SpatialReal AvatarKit에 forward해서 lip-sync로 렌더링한다.
 *
 * Flow:
 *   1. Start (gesture) → AvatarSDK.initialize + setSessionToken + load avatar
 *   2. AvatarView mount + initializeAudioContext + controller.start (24kHz)
 *   3. useLiveSession.connect → ephemeral token → Gemini WS open + setup
 *   4. setupComplete 수신 → sendText('첫 질문 시작') 한 번
 *   5. Gemini가 한국어 발화 → onPcmChunk(b64) 콜백 → SpatialReal.controller.send
 *   6. 사용자가 입모양 + 음소 매칭 평가 (AC-1)
 *   7. End round → sendText로 다음 질문 트리거 (선택)
 *
 * useLiveSession에 onPcmChunk callback을 cherry-pick PR pattern으로 추가했고,
 * 이 callback이 정의되면 useLiveSession의 PCMPlayer는 자동 bypass되어 echo가
 * 발생하지 않는다 (Gemini audio는 SpatialReal SDK 한 곳에서만 재생됨).
 */
import { useEffect, useRef, useState } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import { base64ToArrayBuffer } from '../lib/pcm';
import { buildSystemInstruction } from '../lib/system-instruction';
import { PERSONAS } from '../data';

type SDK = typeof import('@spatialwalk/avatarkit');

type Status =
  | 'idle'
  | 'sdk-loading'
  | 'sdk-initialized'
  | 'avatar-loading'
  | 'avatar-loaded'
  | 'view-created'
  | 'audio-context-ready'
  | 'started'
  | 'error'
  | 'closed';

const PERSONA_ID = 'toss_pm';
const KICKOFF = '면접 시작. 첫 질문해주세요.';

export default function SpikeAvatarTest() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sdkRef = useRef<SDK | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewRef = useRef<any>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [chunkCount, setChunkCount] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [convId, setConvId] = useState<string | null>(null);

  const persona = PERSONAS[PERSONA_ID]!;
  const systemInstruction = buildSystemInstruction(persona);

  const session = useLiveSession({
    systemInstruction,
    onPcmChunk: b64 => {
      const view = viewRef.current;
      if (!view) return;
      const buf = base64ToArrayBuffer(b64);
      const id = view.controller.send(buf, false);
      if (id && !convId) setConvId(id);
      setChunkCount(c => c + 1);
    },
    onOutputTranscript: text => setTranscript(t => t + text),
    onTurnComplete: () => {
      // Mark end of round to SpatialReal so it can finish playback gracefully.
      viewRef.current?.controller?.send(new ArrayBuffer(0), true);
    },
    onError: msg => {
      setError(`live: ${msg}`);
      setStatus('error');
    },
  });

  useEffect(
    () => () => {
      try {
        viewRef.current?.dispose?.();
      } catch {
        /* ignore */
      }
      try {
        sdkRef.current?.AvatarSDK?.cleanup?.();
      } catch {
        /* ignore */
      }
      session.disconnect();
    },
    // session intentionally not in deps — its identity changes on every render
    // and disconnect is a stable cleanup. Empty deps mounts cleanup once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const start = async () => {
    setError(null);
    setTranscript('');
    setChunkCount(0);
    setConvId(null);
    setStatus('sdk-loading');

    try {
      const sdk = await import('@spatialwalk/avatarkit');
      sdkRef.current = sdk;
      const { AvatarSDK, AvatarManager, AvatarView, Environment, DrivingServiceMode, LogLevel } = sdk;

      const appId = import.meta.env.VITE_SPATIALREAL_APP_ID as string | undefined;
      const avatarId = import.meta.env.VITE_SPATIALREAL_AVATAR_ID as string | undefined;
      const sessionToken = import.meta.env.VITE_SPATIALREAL_SESSION_TOKEN as string | undefined;

      if (!appId || !avatarId) {
        throw new Error('VITE_SPATIALREAL_APP_ID 또는 VITE_SPATIALREAL_AVATAR_ID 누락 (.dev.vars 확인)');
      }
      if (!sessionToken || sessionToken.startsWith('PASTE_')) {
        throw new Error('VITE_SPATIALREAL_SESSION_TOKEN 미입력 — Studio에서 발급 후 .dev.vars에 붙여넣기');
      }

      // 24kHz to match Gemini Live output (no resampling).
      await AvatarSDK.initialize(appId, {
        environment: Environment.intl,
        drivingServiceMode: DrivingServiceMode.sdk,
        logLevel: LogLevel.warning,
        audioFormat: { channelCount: 1, sampleRate: 24000 },
      });
      AvatarSDK.setSessionToken(sessionToken);
      setStatus('sdk-initialized');

      setStatus('avatar-loading');
      const avatar = await AvatarManager.shared.load(avatarId, info => {
        if (typeof info.progress === 'number') setProgress(info.progress);
      });
      setStatus('avatar-loaded');

      if (!containerRef.current) throw new Error('container ref not ready');
      const view = new AvatarView(avatar, containerRef.current);
      viewRef.current = view;

      view.controller.onConnectionState = (state: unknown) => {
        console.log('[spike] avatar connection', state);
      };
      view.controller.onConversationState = (state: unknown) => {
        console.log('[spike] avatar conversation', state);
      };
      view.controller.onError = (err: { code: string; message: string }) => {
        console.error('[spike] avatar error', err);
        setError(`avatar: ${err.code}: ${err.message}`);
        setStatus('error');
      };
      setStatus('view-created');

      await view.controller.initializeAudioContext();
      setStatus('audio-context-ready');

      await view.controller.start();
      setStatus('started');

      // Kick off Gemini Live: connect, then on setupComplete sendText to trigger
      // the first interview question from the persona.
      await session.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('error');
    }
  };

  // Once Gemini setup completes (session.state === 'ready'), nudge it once with
  // a short text input so it speaks the first persona question.
  const kickedOffRef = useRef(false);
  useEffect(() => {
    if (session.state === 'ready' && status === 'started' && !kickedOffRef.current) {
      kickedOffRef.current = true;
      session.sendText(KICKOFF);
    }
  }, [session, session.state, status]);

  const askNext = () => {
    if (session.state === 'ready') {
      session.sendText('답변 받았습니다. 다음 질문해주세요.');
    }
  };

  const close = () => {
    session.disconnect();
    try {
      viewRef.current?.dispose?.();
    } catch {
      /* ignore */
    }
    viewRef.current = null;
    try {
      sdkRef.current?.AvatarSDK?.cleanup?.();
    } catch {
      /* ignore */
    }
    sdkRef.current = null;
    kickedOffRef.current = false;
    setStatus('closed');
    setProgress(null);
    setConvId(null);
    setChunkCount(0);
    setTranscript('');
  };

  const canStart = status === 'idle' || status === 'error' || status === 'closed';

  return (
    <div
      style={{
        padding: 24,
        background: '#0a0a0a',
        color: '#e5e5e5',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ marginTop: 0, fontSize: 22 }}>
        SpatialReal Spike — 면접관 아바타 한국어 발화 테스트
      </h1>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>
        feat/spatialreal-spike · ?spike=1 · 페르소나: {persona.company.name} {persona.company.role}{' '}
        ({PERSONA_ID}) · Gemini Live → SpatialReal forward
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={start} disabled={!canStart}>
          1. Start (gesture required) — 아바타 + Gemini 연결 + 자동 첫 질문
        </button>
        <button onClick={askNext} disabled={status !== 'started' || session.state !== 'ready'}>
          2. 다음 질문 (선택)
        </button>
        <button onClick={close} disabled={status === 'idle' || status === 'closed'}>
          Close
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 12,
          fontSize: 13,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span>
          Avatar: <code style={{ color: '#7dd3fc' }}>{status}</code>
        </span>
        <span>
          Live: <code style={{ color: '#86efac' }}>{session.state}</code>
        </span>
        {progress !== null && progress < 1 && <span>Avatar load: {(progress * 100).toFixed(0)}%</span>}
        {convId && (
          <span>
            Conv: <code>{convId.slice(0, 8)}…</code>
          </span>
        )}
        {chunkCount > 0 && <span>PCM chunks → SDK: {chunkCount}</span>}
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: '#7f1d1d',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}
        >
          ❌ {error}
        </div>
      )}

      {session.lastError && !error && (
        <div
          style={{
            padding: 12,
            background: '#78350f',
            borderRadius: 4,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          ⚠ live session: {session.lastError}
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          width: '100%',
          maxWidth: 800,
          aspectRatio: '1 / 1',
          background: '#1c1917',
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
        }}
      />

      {transcript && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: '#1c1917',
            borderRadius: 4,
            fontSize: 14,
            lineHeight: 1.6,
            maxWidth: 800,
            whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>면접관 발화 (transcript)</div>
          {transcript}
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 12, opacity: 0.6, lineHeight: 1.6, maxWidth: 800 }}>
        <strong>채점 (AC-1):</strong> Gemini가 발화한 한국어가 SpatialReal에서 입모양으로 정확히
        rendering되는지 평가.
        <br />
        Score 5=원어민, 4=명확히 정확, 3=대체로 정확(PARTIAL), 2=근사, 1=깨짐(영어 phoneme 근사).
        <br />
        ≥ 4 → GO · = 3 → PARTIAL (Day 2-3 누적 2h tuning) · ≤ 2 → 즉시 NO-GO (Lottie 단축형).
      </p>
    </div>
  );
}
