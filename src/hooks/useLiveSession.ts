import { useCallback, useEffect, useRef, useState } from 'react';
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
    if (msg.setupComplete) {
      setupCompleteRef.current = true;
      setState('ready');
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    const parts = sc.modelTurn?.parts ?? [];
    for (const p of parts) {
      if (p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/pcm')) {
        if (!firstAudioFiredRef.current) {
          firstAudioFiredRef.current = true;
          optsRef.current.onFirstAudio?.();
        }
        playerRef.current?.enqueue(p.inlineData.data);
        setState('speaking');
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
          },
          realtimeInputConfig: {
            // Manual VAD: client signals turn boundaries via activityStart/End.
            // Aligns with the button-driven 답변 시작/답변 종료 UX.
            automaticActivityDetection: { disabled: true },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      };
      ws.send(JSON.stringify(setup));
    };

    ws.onmessage = async (e: MessageEvent) => {
      let raw: string;
      if (e.data instanceof Blob) {
        raw = await e.data.text();
      } else if (typeof e.data === 'string') {
        raw = e.data;
      } else {
        return;
      }
      try {
        const msg = JSON.parse(raw) as ServerMessage;
        handleServerMessage(msg);
      } catch {
        /* unparseable frame; ignore */
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

    // Manual VAD: tell server the user is starting to speak.
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
    void cleanupTurnAudio();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Manual VAD end-of-turn marker.
      ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
    }
    setState('thinking');
  }, [cleanupTurnAudio]);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    turnStartTsRef.current = Date.now();
    firstAudioFiredRef.current = false;
    ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        },
      }),
    );
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
  };
}
