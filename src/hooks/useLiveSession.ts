import { useCallback, useEffect, useRef, useState } from 'react';

// Build marker — git short SHA injected by Vite `define` (see vite.config.ts).
// Auto-bumps on every commit so caching / stale-bundle issues are unambiguous
// in DevTools. Replaces the manual `v11`-style marker that survived a revert.
console.log('[live build]', __BUILD_SHA__);
console.log(
  '[live] n-frame loop enabled:',
  import.meta.env.VITE_N_FRAME_LOOP_ENABLED ?? '1 (default)',
);
import type { AudioCaptureHandle } from '../lib/audio-capture';
import { startAudioCapture } from '../lib/audio-capture';
import { PCMPlayer } from '../lib/pcm-player';
import { captureWebcamJpeg } from '../lib/webcam';

// Visual-ack telemetry phrase list — regex source of truth. Mirrors the locked
// list in .omc/specs/deep-interview-n-frame.md, .omc/plans/n-frame-multi-frame.md,
// .omc/spikes/n-frame-spike-2026-05-08.md, and README.md "Deferred verifications".
// Change requires synchronized update across all five.
const VISUAL_ACK_PATTERN = /(표정|자세|끄덕|손짓|편안|긴장|변화|미소)/;

export type SessionState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface UseLiveSessionOptions {
  /** Composed string with persona resume + company + propositions + interview rules. */
  systemInstruction: string;
  onInputTranscript?: (text: string) => void;
  onOutputTranscript?: (text: string) => void;
  onTurnComplete?: () => void;
  onFirstAudio?: () => void;
  onError?: (err: string) => void;
  /**
   * Optional fan-out for the raw 24kHz Int16 base64 PCM chunks the server
   * emits. When set, the consumer takes ownership of audio playback and the
   * built-in `PCMPlayer.enqueue` is bypassed to avoid double-playback (echo).
   * Used by SpatialReal AvatarKit so it can drive lip-sync from the same
   * stream the live API emits.
   */
  onPcmChunk?: (b64: string) => void;
}

export interface LiveSessionApi {
  state: SessionState;
  lastError: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  startTurn: () => Promise<void>;
  endTurn: () => void;
  /** Send a text-only client turn. Path B note: avoid mixing with manual VAD — server may
   *  treat text + manual activity as a precondition violation (1007), even on Unconstrained. */
  sendText: (text: string) => void;
  /** Kickoff: send a zero-content user turn (activityStart + 100ms silent PCM + activityEnd)
   *  so the model emits the systemInstruction-directed first interviewer utterance without
   *  text input contaminating the session. */
  sendKickoff: () => void;
}

interface ServerMessage {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
    generationComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
  usageMetadata?: unknown;
}

export function useLiveSession(opts: UseLiveSessionOptions): LiveSessionApi {
  const [state, setState] = useState<SessionState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCaptureHandle | null>(null);
  const playerRef = useRef<PCMPlayer | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stateRef = useRef<SessionState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const turnStartTsRef = useRef<number | null>(null);
  const firstAudioFiredRef = useRef(false);
  const setupCompleteRef = useRef(false);

  // 1 fps multi-frame video stream (Day 2 of n-frame plan).
  // Lifecycle: setInterval started in startTurn, cleared in clearVideoInterval
  // which is invoked from 5 paths (endTurn, disconnect, ws.onerror, ws.onclose,
  // useEffect cleanup via disconnect). Leak between turns confuses the model.
  const videoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const framesSentRef = useRef<number>(0);
  // Visual-ack telemetry — per-turn accumulator + cumulative rate.
  const outputAccumRef = useRef<string>('');
  const visualAckSeenRef = useRef<boolean>(false);
  const visualAckTurnsRef = useRef<number>(0);
  const totalTurnsRef = useRef<number>(0);

  const setError = useCallback((err: string) => {
    setLastError(err);
    setState('error');
    optsRef.current.onError?.(err);
  }, []);

  const cleanupTurnAudio = useCallback(async () => {
    if (captureRef.current) {
      await captureRef.current.stop();
      captureRef.current = null;
    }
  }, []);

  // Idempotent: callable twice with no error. Sets ref to null (not just clears
  // the timer) and resets the per-turn frame counter so it does not bleed into
  // the next turn. Called from 5 cleanup paths (endTurn, disconnect, ws.onerror,
  // ws.onclose, useEffect cleanup via disconnect).
  const clearVideoInterval = useCallback(() => {
    if (videoIntervalRef.current !== null) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    framesSentRef.current = 0;
    if (import.meta.env.DEV && videoIntervalRef.current !== null) {
      console.error('[live] BUG: clearVideoInterval did not null the ref');
    }
  }, []);

  const disconnect = useCallback(() => {
    clearVideoInterval();
    if (import.meta.env.DEV && videoIntervalRef.current !== null) {
      console.error('[live] BUG: videoIntervalRef not cleared in disconnect');
    }
    void cleanupTurnAudio();
    void playerRef.current?.close();
    playerRef.current = null;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
    }
    wsRef.current = null;
    turnStartTsRef.current = null;
    firstAudioFiredRef.current = false;
    setState('idle');
  }, [cleanupTurnAudio, clearVideoInterval]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    // Quiet trace: only log frames that carry actionable signal (transcript,
    // turn boundaries, errors). Audio-only chunks are skipped so the console
    // stays readable across multi-turn sessions.
    if (typeof console !== 'undefined') {
      const sc = msg.serverContent;
      // Log only state-machine-significant events. Streaming transcript
      // chunks (input/outputTranscription.text) fire 20-30x per turn and
      // flood the console without diagnostic value — drop them. Full
      // transcript still accumulates via the onInputTranscript /
      // onOutputTranscript callbacks below.
      const hasBoundary = !!(sc?.turnComplete || sc?.generationComplete || sc?.interrupted);
      const interesting = msg.setupComplete || msg.goAway || hasBoundary;
      if (interesting) {
        const debug: Record<string, unknown> = {};
        if (msg.setupComplete) debug.setupComplete = true;
        if (sc?.generationComplete) debug.generationComplete = true;
        if (sc?.turnComplete) debug.turnComplete = true;
        if (sc?.interrupted) debug.interrupted = true;
        if (msg.goAway) debug.goAway = msg.goAway;
        console.log('[live]', debug);
      }
    }

    if (msg.setupComplete) {
      setupCompleteRef.current = true;
      setState('ready');
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    const parts = sc.modelTurn?.parts ?? [];
    for (const p of parts) {
      // Audio chunks: any audio/* mime type with data.
      if (p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/')) {
        if (!firstAudioFiredRef.current) {
          firstAudioFiredRef.current = true;
          optsRef.current.onFirstAudio?.();
        }
        const consumer = optsRef.current.onPcmChunk;
        if (consumer) {
          // Caller owns playback (e.g. SpatialReal SDK). Bypass PCMPlayer
          // to prevent double-playback / echo. Isolate handler throws so a
          // bad consumer can't break the Gemini message loop.
          try {
            consumer(p.inlineData.data);
          } catch (err) {
            console.warn('[live] onPcmChunk handler threw (isolated)', err);
          }
        } else {
          playerRef.current?.enqueue(p.inlineData.data);
        }
        setState('speaking');
      }
      // Text parts: treat as output transcript so the UI shows them even if
      // server returns text-only without audio.
      if (p.text) {
        optsRef.current.onOutputTranscript?.(p.text);
      }
    }

    if (sc.inputTranscription?.text) {
      optsRef.current.onInputTranscript?.(sc.inputTranscription.text);
    }
    if (sc.outputTranscription?.text) {
      outputAccumRef.current += sc.outputTranscription.text;
      if (!visualAckSeenRef.current && VISUAL_ACK_PATTERN.test(outputAccumRef.current)) {
        visualAckSeenRef.current = true;
      }
      optsRef.current.onOutputTranscript?.(sc.outputTranscription.text);
    }
    if (sc.interrupted) {
      playerRef.current?.reset();
    }
    if (sc.turnComplete) {
      if (visualAckSeenRef.current) visualAckTurnsRef.current += 1;
      console.log(
        '[live] visual-ack:',
        visualAckSeenRef.current,
        'rate:',
        `${visualAckTurnsRef.current}/${totalTurnsRef.current}`,
      );
      outputAccumRef.current = '';
      firstAudioFiredRef.current = false;
      setState('ready');
      optsRef.current.onTurnComplete?.();
    }
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setState('connecting');
    setLastError(null);

    setupCompleteRef.current = false;

    // Path B: connect to worker WS bridge. Worker holds GEMINI_API_KEY and
    // proxies to Gemini `v1beta.BidiGenerateContent` (Unconstrained), which
    // is the only method that accepts manual VAD activity markers without
    // 1007 — the entire reason for this architecture. Same-origin gate on
    // `/api/live-ws` is the auth boundary; no client-side token needed.
    // `mintLiveToken` (`/api/live-token`) is retained ONLY for hybrid backward
    // compat during transition; not used here.
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${wsProtocol}//${window.location.host}/api/live-ws`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setError(`websocket open: ${(e as Error).message}`);
      return;
    }
    wsRef.current = ws;
    playerRef.current = new PCMPlayer();

    ws.onopen = () => {
      const setup = {
        setup: {
          // Auto-kickoff and audio behavior verified for this model on
          // 2026-05-08 (.omc/spikes/manual-vad-b-option-2026-05-08.md).
          // Model bumps require re-verification of AC-1/AC-3/AC-5 — see
          // .omc/plans/worker-ws-proxy-b-option.md model-bump checkbox.
          model: 'models/gemini-3.1-flash-live-preview',
          systemInstruction: {
            parts: [{ text: optsRef.current.systemInstruction }],
          },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              languageCode: 'ko-KR',
            },
          },
          realtimeInputConfig: {
            // Manual VAD: client owns turn boundaries via activityStart/End
            // (sent in startTurn / endTurn). Unconstrained method accepts
            // this where Constrained rejects with 1007.
            automaticActivityDetection: { disabled: true },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      console.log('[live send] setup', setup);
      ws.send(JSON.stringify(setup));
    };

    ws.onmessage = async (e: MessageEvent) => {
      let raw: string;
      if (e.data instanceof Blob) {
        raw = await e.data.text();
      } else if (typeof e.data === 'string') {
        raw = e.data;
      } else {
        console.log('[live recv raw]', 'non-text frame', e.data);
        return;
      }
      try {
        const msg = JSON.parse(raw) as ServerMessage;
        handleServerMessage(msg);
      } catch (err) {
        console.warn('[live recv] JSON parse failed', err);
      }
    };

    ws.onerror = () => {
      clearVideoInterval();
      if (import.meta.env.DEV && videoIntervalRef.current !== null) {
        console.error('[live] BUG: videoIntervalRef not cleared in ws.onerror');
      }
      setError('websocket error');
    };
    ws.onclose = ev => {
      clearVideoInterval();
      if (import.meta.env.DEV && videoIntervalRef.current !== null) {
        console.error('[live] BUG: videoIntervalRef not cleared in ws.onclose');
      }
      wsRef.current = null;
      setupCompleteRef.current = false;
      void cleanupTurnAudio();
      if (stateRef.current !== 'error') setState('idle');
      if (ev.code !== 1000 && ev.code !== 1005) {
        setError(`websocket closed: ${ev.code} ${ev.reason || ''}`.trim());
      }
    };
  }, [cleanupTurnAudio, clearVideoInterval, handleServerMessage, setError]);

  const startTurn = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!setupCompleteRef.current) return;
    if (stateRef.current === 'speaking' || stateRef.current === 'thinking' || stateRef.current === 'listening') {
      return;
    }

    framesSentRef.current = 0;
    visualAckSeenRef.current = false;
    totalTurnsRef.current += 1;

    setState('listening');
    turnStartTsRef.current = Date.now();
    firstAudioFiredRef.current = false;

    // Manual VAD: explicit start-of-user-turn marker. The model treats the
    // window between this and the matching activityEnd in endTurn() as one
    // user turn, regardless of audio silences within.
    ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));

    const frame = await captureWebcamJpeg();
    if (frame && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          realtimeInput: {
            video: { mimeType: frame.mimeType, data: frame.b64 },
          },
        }),
      );
    }

    // 1 fps multi-frame stream during the turn. Kill switch: set
    // VITE_N_FRAME_LOOP_ENABLED='0' at build time to fall back to the original
    // single-frame behavior without code revert.
    const N_FRAME_ENABLED = import.meta.env.VITE_N_FRAME_LOOP_ENABLED ?? '1';
    if (N_FRAME_ENABLED !== '0') {
      const captureAndSendFrame = async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const f = await captureWebcamJpeg();
        if (!f || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            realtimeInput: { video: { mimeType: f.mimeType, data: f.b64 } },
          }),
        );
        framesSentRef.current += 1;
        if (framesSentRef.current % 5 === 0) {
          console.log('[live] frames sent in current turn:', framesSentRef.current);
        }
      };
      videoIntervalRef.current = setInterval(captureAndSendFrame, 1000);
    }

    try {
      captureRef.current = await startAudioCapture({
        onChunk: b64 => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                realtimeInput: {
                  audio: { mimeType: 'audio/pcm;rate=16000', data: b64 },
                },
              }),
            );
          }
        },
      });
    } catch (e) {
      setError(`mic: ${(e as Error).message}`);
    }
  }, [setError]);

  const endTurn = useCallback(() => {
    // Manual VAD: button click is the authoritative end-of-turn signal.
    // No silence tail / no server-side VAD threshold tuning — we just tell
    // the server "this user turn is done" and immediately cut the mic.
    // clearVideoInterval first so no stray frame slips past activityEnd.
    // Snapshot framesSentRef before clearing — the helper resets it to 0.
    const totalFrames = framesSentRef.current;
    clearVideoInterval();
    if (import.meta.env.DEV && videoIntervalRef.current !== null) {
      console.error('[live] BUG: videoIntervalRef not cleared in endTurn');
    }
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    }
    console.log('[live] turn ended; total video frames:', totalFrames);
    setState('thinking');
    void cleanupTurnAudio();
  }, [cleanupTurnAudio, clearVideoInterval]);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    turnStartTsRef.current = Date.now();
    firstAudioFiredRef.current = false;
    // realtimeInput.text alone. Path B caveat: do NOT mix with manual VAD
    // markers in the same session — server treats it as a precondition
    // violation and closes 1007 even on Unconstrained method.
    const payload = { realtimeInput: { text } };
    console.log('[live send] realtimeInput.text', payload);
    ws.send(JSON.stringify(payload));
    setState('thinking');
  }, []);

  const sendKickoff = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    turnStartTsRef.current = Date.now();
    firstAudioFiredRef.current = false;
    // Manual VAD kickoff: send a zero-content user turn so the model
    // responds with the systemInstruction-directed first utterance. Text
    // input is intentionally avoided — mixing text + manual activity in the
    // same session triggers 1007 (observed empirically on Unconstrained too,
    // not just Constrained as the original code comment suggested).
    //
    // 100ms silent PCM at 16kHz mono int16 = 3200 bytes of zeros. The audio
    // matters: empty activity-pair without any audio bytes is also rejected.
    ws.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
    const silent = new Uint8Array(3200);
    let bin = '';
    for (let i = 0; i < silent.length; i++) bin += String.fromCharCode(silent[i]);
    const b64 = btoa(bin);
    ws.send(
      JSON.stringify({
        realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: b64 } },
      }),
    );
    ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    setState('thinking');
  }, []);

  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect],
  );

  return {
    state,
    lastError,
    connect,
    disconnect,
    startTurn,
    endTurn,
    sendText,
    sendKickoff,
  };
}
