import { useCallback, useEffect, useRef, useState } from 'react';

// Build marker — bump on every change so caching can be diagnosed in DevTools.
console.log('[live build] v11 — auto VAD, drop activity markers');
import type { AudioCaptureHandle } from '../lib/audio-capture';
import { startAudioCapture } from '../lib/audio-capture';
import { PCMPlayer } from '../lib/pcm-player';
import { captureWebcamJpeg } from '../lib/webcam';

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
  /** Send a text-only client turn (used to kick off the first interviewer question). */
  sendText: (text: string) => void;
}

interface LiveTokenResponse {
  ok: boolean;
  demo: boolean;
  token: string;
  model: string;
  expireTime: string;
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

  const disconnect = useCallback(() => {
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
  }, [cleanupTurnAudio]);

  const handleServerMessage = useCallback((msg: ServerMessage) => {
    // Quiet trace: only log frames that carry actionable signal (transcript,
    // turn boundaries, errors). Audio-only chunks are skipped so the console
    // stays readable across multi-turn sessions.
    if (typeof console !== 'undefined') {
      const sc = msg.serverContent;
      const hasTranscript = !!(sc?.inputTranscription?.text || sc?.outputTranscription?.text);
      const hasBoundary = !!(sc?.turnComplete || sc?.generationComplete || sc?.interrupted);
      const hasText = !!sc?.modelTurn?.parts?.some(p => p.text);
      const interesting = msg.setupComplete || msg.goAway || hasTranscript || hasBoundary || hasText;
      if (interesting) {
        const debug: Record<string, unknown> = {};
        if (msg.setupComplete) debug.setupComplete = true;
        if (sc?.inputTranscription?.text) debug.inputTranscript = sc.inputTranscription.text;
        if (sc?.outputTranscription?.text) debug.outputTranscript = sc.outputTranscription.text;
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
      optsRef.current.onOutputTranscript?.(sc.outputTranscription.text);
    }
    if (sc.interrupted) {
      playerRef.current?.reset();
    }
    if (sc.turnComplete) {
      firstAudioFiredRef.current = false;
      setState('ready');
      optsRef.current.onTurnComplete?.();
    }
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current) return;
    setState('connecting');
    setLastError(null);

    let tokenData: LiveTokenResponse;
    try {
      const r = await fetch('/api/live-token', { method: 'POST' });
      if (!r.ok) throw new Error(`token fetch ${r.status}`);
      tokenData = (await r.json()) as LiveTokenResponse;
    } catch (e) {
      setError(`token: ${(e as Error).message}`);
      return;
    }

    if (!tokenData.ok || !tokenData.token) {
      setError('token missing in response');
      return;
    }

    if (tokenData.demo || tokenData.token === 'DEMO_TOKEN_NO_REAL_API') {
      setError('GEMINI_API_KEY 미설정 (서버 DEMO_MODE). wrangler secret put GEMINI_API_KEY 후 재배포 필요.');
      return;
    }

    setupCompleteRef.current = false;

    // Ephemeral tokens (auth_tokens/...) are minted under v1alpha and the
    // method is `BidiGenerateContentConstrained` (not BidiGenerateContent).
    // Per @google/genai SDK convention: token prefix triggers v1alpha and the
    // constrained method; auth via ?access_token=.
    const url =
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained` +
      `?access_token=${encodeURIComponent(tokenData.token)}`;

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
          model: `models/${tokenData.model}`,
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
            // Manual VAD: client owns turn boundaries via activityStart/End.
            // Auto VAD silenceDurationMs is gone — button click is authoritative.
            // Auto-kickoff (server emits first interviewer turn from
            // systemInstruction without client-side text input) is verified for
            // gemini-3.1-flash-live-preview as of 2026-05-07. Model bumps
            // require re-verification — see .omc/plans/manual-vad-migration.md
            // AC-5 and the model-bump checkbox in the corresponding PR.
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

    ws.onerror = () => setError('websocket error');
    ws.onclose = ev => {
      wsRef.current = null;
      setupCompleteRef.current = false;
      void cleanupTurnAudio();
      if (stateRef.current !== 'error') setState('idle');
      if (ev.code !== 1000 && ev.code !== 1005) {
        setError(`websocket closed: ${ev.code} ${ev.reason || ''}`.trim());
      }
    };
  }, [cleanupTurnAudio, handleServerMessage, setError]);

  const startTurn = useCallback(async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!setupCompleteRef.current) return;
    if (stateRef.current === 'speaking' || stateRef.current === 'thinking' || stateRef.current === 'listening') {
      return;
    }

    setState('listening');
    turnStartTsRef.current = Date.now();
    firstAudioFiredRef.current = false;

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
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    }
    setState('thinking');
    void cleanupTurnAudio();
  }, [cleanupTurnAudio]);

  const sendText = useCallback((text: string) => {
    // Manual VAD migration locks this codebase out of text input on the
    // Constrained method (text + manual activity = 1007 Precondition fail).
    // Throw loudly so any future caller cannot silently regress us.
    // To re-enable text input, migrate to Unconstrained via worker WS proxy
    // (B-option, see .omc/plans/manual-vad-migration.md §6 follow-ups).
    throw new Error(
      `[useLiveSession] sendText is incompatible with manual VAD on Constrained method (1007). ` +
        `Migrate to Unconstrained via worker WS proxy to re-enable text input. ` +
        `Attempted text: ${text.slice(0, 40)}`,
    );
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
  };
}
