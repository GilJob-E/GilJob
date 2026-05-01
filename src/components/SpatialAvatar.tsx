/**
 * SpatialAvatar — 3D 면접관 아바타 (production).
 *
 * `useLiveSession`이 emit하는 24kHz Int16 PCM b64 청크를 SpatialReal
 * AvatarKit에 forward해서 lip-sync로 렌더링한다. SDK가 audio playback도
 * 자체 관리하므로 Interview는 `useLiveSession.onPcmChunk` callback을
 * 통해 PCMPlayer를 bypass한다 (double-playback / echo 방지).
 *
 * 토큰 발급은 worker `/api/avatarkit-token` 경유 — Phase B (현재)는 env에
 * 저장된 수동 rotation 토큰을 그대로 반환, Phase A (TBD)는 vendor mint
 * endpoint를 worker가 server-side로 호출.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { base64ToArrayBuffer } from '../lib/pcm';

type SDK = typeof import('@spatialwalk/avatarkit');

export interface SpatialAvatarHandle {
  /** Forward a base64-encoded 16-bit PCM chunk to the avatar SDK. */
  pushPcm: (b64: string) => void;
  /** Signal end-of-utterance so the SDK can drain animation frames. */
  endRound: () => void;
}

interface AvatarKitTokenResponse {
  ok: boolean;
  appId?: string;
  avatarId?: string;
  sessionToken?: string;
  expiresIn?: number;
  error?: string;
}

const SpatialAvatar = forwardRef<SpatialAvatarHandle, { className?: string }>(
  ({ className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const sdkRef = useRef<SDK | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const viewRef = useRef<any>(null);
    const startedRef = useRef(false);
    // Buffer PCM chunks that arrive before SDK init completes. Cap prevents
    // unbounded growth if init never resolves. ~5s of 24kHz audio at typical
    // chunk size (≈2KB / 80ms) ≈ 60 chunks; allow some headroom.
    const pendingChunksRef = useRef<string[]>([]);
    const PENDING_MAX = 200;

    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        pushPcm: (b64: string) => {
          const view = viewRef.current;
          if (!view || !startedRef.current) {
            // Avatar not ready yet — queue chunks so we don't lose the first
            // turn's audio. Drained when controller.start() resolves below.
            if (pendingChunksRef.current.length < PENDING_MAX) {
              pendingChunksRef.current.push(b64);
            }
            return;
          }
          try {
            const buf = base64ToArrayBuffer(b64);
            view.controller.send(buf, false);
          } catch (e) {
            console.warn('[spatialavatar] pushPcm failed', e);
          }
        },
        endRound: () => {
          const view = viewRef.current;
          if (!view || !startedRef.current) return;
          try {
            view.controller.send(new ArrayBuffer(0), true);
          } catch (e) {
            console.warn('[spatialavatar] endRound failed', e);
          }
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;

      void (async () => {
        try {
          const tokenRes = await fetch('/api/avatarkit-token', { method: 'POST' });
          if (!tokenRes.ok) throw new Error(`avatarkit-token ${tokenRes.status}`);
          const data = (await tokenRes.json()) as AvatarKitTokenResponse;
          if (cancelled) return;
          if (!data.ok || !data.appId || !data.avatarId || !data.sessionToken) {
            throw new Error(data.error ?? 'avatarkit token response missing fields');
          }

          const sdk = await import('@spatialwalk/avatarkit');
          if (cancelled) return;
          sdkRef.current = sdk;
          const { AvatarSDK, AvatarManager, AvatarView, Environment, DrivingServiceMode, LogLevel } = sdk;

          // 24kHz to match Gemini Live PCM (no resampling).
          await AvatarSDK.initialize(data.appId, {
            environment: Environment.intl,
            drivingServiceMode: DrivingServiceMode.sdk,
            logLevel: LogLevel.warning,
            audioFormat: { channelCount: 1, sampleRate: 24000 },
          });
          if (cancelled) return;
          AvatarSDK.setSessionToken(data.sessionToken);

          const avatar = await AvatarManager.shared.load(data.avatarId, info => {
            if (cancelled) return;
            if (typeof info.progress === 'number') setProgress(info.progress);
          });
          if (cancelled) return;

          if (!containerRef.current) throw new Error('container not mounted');
          const view = new AvatarView(avatar, containerRef.current);
          viewRef.current = view;
          view.controller.onError = (err: { code: string; message: string }) => {
            console.error('[spatialavatar] error', err);
            if (!cancelled) setError(`${err.code}: ${err.message}`);
          };

          // CRITICAL: `controller.start()` resolves before the SDK's internal
          // WebSocket session reaches the `connected` state. If we send audio
          // between start()-resolve and connection-state="connected", the SDK
          // logs `Session not configured yet, skipping audio send`, treats the
          // first chunk as empty animation, and enters a permanent fallback
          // mode that ignores all subsequent animation. Use the connection-
          // state callback as the real readiness gate, not start()'s promise.
          view.controller.onConnectionState = (state: string) => {
            console.log('[spatialavatar] connection', state);
            if (cancelled) return;
            if (state === 'connected' && !startedRef.current) {
              startedRef.current = true;
              setLoading(false);
              // Drain queued chunks that arrived during init. Preserves first
              // turn audio that was forwarded before the SDK was ready.
              const pending = pendingChunksRef.current;
              pendingChunksRef.current = [];
              for (const b64 of pending) {
                try {
                  view.controller.send(base64ToArrayBuffer(b64), false);
                } catch (e) {
                  console.warn('[spatialavatar] drain pushPcm failed', e);
                }
              }
            } else if (state === 'failed') {
              setError('avatar connection failed');
              setLoading(false);
            }
          };
          view.controller.onConversationState = (state: string) => {
            console.log('[spatialavatar] conversation', state);
          };

          // initializeAudioContext must be inside a user gesture. Mounting
          // directly after the user clicks "면접 시작하기" usually keeps the
          // gesture window open across the React commit; if a browser rejects
          // it, surface the error so we can add an explicit "Start" overlay.
          await view.controller.initializeAudioContext();
          if (cancelled) return;
          await view.controller.start();
          if (cancelled) return;
          // Note: do NOT set startedRef here — onConnectionState handler does
          // it once the underlying session is actually ready to accept audio.
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
        startedRef.current = false;
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
      };
    }, []);

    return (
      <div
        className={className}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: '#1c1917',
          borderRadius: 'inherit',
          overflow: 'hidden',
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {loading && !error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(28, 25, 23, 0.85)',
              color: '#e7e5e4',
              fontSize: 13,
              gap: 8,
            }}
          >
            <span>면접관 아바타 로드 중…</span>
            {progress !== null && (
              <span style={{ opacity: 0.7, fontSize: 11 }}>{(progress * 100).toFixed(0)}%</span>
            )}
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(127, 29, 29, 0.92)',
              color: '#fee2e2',
              fontSize: 12,
              padding: 16,
              textAlign: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 14 }}>❌ 아바타 오류</span>
            <span style={{ opacity: 0.85, fontSize: 11 }}>{error}</span>
          </div>
        )}
      </div>
    );
  },
);

SpatialAvatar.displayName = 'SpatialAvatar';
export default SpatialAvatar;
