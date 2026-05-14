import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import SpatialAvatar, { type SpatialAvatarHandle } from './SpatialAvatar';
import { useLiveSession, type SessionState } from '../hooks/useLiveSession';
import { buildSystemInstruction } from '../lib/system-instruction';
import type {
  AvatarStyle,
  ForcedState,
  HashimotoStrategy,
  InterviewState,
  Latency,
  OrbColor,
  Persona,
  TranscriptTurn,
  InterviewResult,
} from '../types';

function mapSessionState(s: SessionState): InterviewState {
  switch (s) {
    case 'connecting':
    case 'thinking':
      return 'thinking';
    case 'listening':
      return 'listening';
    case 'speaking':
      return 'speaking';
    case 'idle':
    case 'ready':
    case 'error':
    default:
      return 'idle';
  }
}

function StateBadge({ state }: { state: InterviewState }) {
  const map = {
    idle: { label: '대기 중', cls: 'badge-dot' },
    listening: { label: '녹음 중', cls: 'badge-live' },
    thinking: { label: '분석 중', cls: 'badge-dot' },
    speaking: { label: '응답 중', cls: 'badge-success' },
  } as const;
  const m = map[state] || map.idle;
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function Waveform({ active }: { active: boolean }) {
  const bars = 36;
  return (
    <div className="waveform">
      {Array.from({ length: bars }).map((_, i) => {
        const phase = (i / bars) * Math.PI * 2;
        const h = active ? 6 + Math.abs(Math.sin(phase * 1.7 + i)) * 22 : 3;
        return <span key={i} style={{ height: h, transitionDelay: `${i * 8}ms` }} />;
      })}
    </div>
  );
}

function VisionPanel({ captured, captureFlash }: { captured: boolean; captureFlash: boolean }) {
  return (
    <div className="vision-card">
      <div className="vision-head">
        <span className="caption-up">비전</span>
        <span className="mono-xs" style={{ color: 'var(--muted)' }}>1 fps · Live API</span>
      </div>
      <div className="vision-frame">
        <div className={`vision-thumb ${captureFlash ? 'flash' : ''}`}>
          <div className="vision-thumb-inner">
            <svg viewBox="0 0 120 90" width="100%" height="100%">
              <rect width="120" height="90" fill="#1c1917" />
              <circle cx="60" cy="38" r="14" fill="#3a3633" />
              <path d="M30 90 Q30 64 60 60 Q90 64 90 90 Z" fill="#3a3633" />
              <rect x="2" y="2" width="20" height="2" fill="#a7e5d3" opacity="0.7" />
              <rect x="2" y="6" width="14" height="2" fill="#a7e5d3" opacity="0.4" />
            </svg>
          </div>
          <span className="vision-cross v-tl" />
          <span className="vision-cross v-tr" />
          <span className="vision-cross v-bl" />
          <span className="vision-cross v-br" />
        </div>
        <div className="vision-keywords">
          <span className="caption" style={{ color: 'var(--muted-soft)', fontSize: 12 }}>
            {captured
              ? '프레임 송신 중 · 1초 간격'
              : '발화 중 1초 간격으로 프레임 캡처'}
          </span>
        </div>
      </div>
    </div>
  );
}

function LatencyBars({ ttft }: { ttft: number }) {
  const max = 4000;
  return (
    <div className="latency-block">
      <div className="latency-head">
        <span className="caption-up">TTFT</span>
        <span className="mono-sm" style={{ color: 'var(--ink)' }}>{(ttft / 1000).toFixed(2)}s</span>
      </div>
      <div className="latency-list">
        <div className="latency-row">
          <span className="latency-label">turn → 1st audio</span>
          <div className="latency-bar">
            <span className="latency-bar-fill" style={{ width: `${Math.min(100, (ttft / max) * 100)}%` }} />
          </div>
          <span className="mono-xs latency-val">{ttft}<span style={{ color: 'var(--muted-soft)' }}>ms</span></span>
        </div>
      </div>
    </div>
  );
}

function HashimotoPanel({ strategy, analyzing }: { strategy: HashimotoStrategy | null; analyzing: boolean }) {
  return (
    <div className="vision-card">
      <div className="vision-head">
        <span className="caption-up">Hashimoto</span>
        <span className="mono-xs" style={{ color: analyzing ? 'var(--accent)' : 'var(--muted)' }}>
          {analyzing ? '분석 중…' : strategy ? '전략 주입됨' : '대기'}
        </span>
      </div>
      {strategy && (
        <div style={{ fontSize: 11, color: 'var(--muted-soft)', lineHeight: 1.6, padding: '6px 0' }}>
          <div><span style={{ color: 'var(--ink)' }}>주제</span> {strategy.current_context.topic} (깊이 {strategy.current_context.depth_level})</div>
          <div><span style={{ color: 'var(--ink)' }}>목표</span> {strategy.logic_goal}</div>
          <div><span style={{ color: 'var(--ink)' }}>공백</span> {strategy.logical_gap_to_bridge}</div>
          <div><span style={{ color: 'var(--ink)' }}>톤</span> {strategy.interviewer_persona_guidance.emotion_direction}</div>
          {strategy.current_context.topic_changed && (
            <div style={{ color: 'var(--accent)' }}>▶ 주제 전환</div>
          )}
        </div>
      )}
    </div>
  );
}

function Pipeline({ state }: { state: InterviewState }) {
  return (
    <div className="pipeline-card-compact">
      <span className="caption-up">Pipeline</span>
      <div className="pipeline">
        <div className={`pipe-node ${state === 'listening' ? 'on' : ''}`}>VAD</div>
        <div className="pipe-edge"><span style={{ animationPlayState: state === 'listening' ? 'running' : 'paused' }} /></div>
        <div className={`pipe-node ${state === 'thinking' ? 'on' : ''}`}>LiveAPI</div>
        <div className="pipe-edge"><span style={{ animationPlayState: state === 'thinking' ? 'running' : 'paused' }} /></div>
        <div className={`pipe-node ${state === 'speaking' ? 'on' : ''}`}>TTS</div>
      </div>
      <div className="pipe-parallel">
        <div className="pipe-parallel-inner">
          <div className={`pipe-node small ${state === 'listening' ? 'on' : ''}`}>Frame</div>
          <div className="pipe-edge small"><span style={{ animationPlayState: state === 'listening' ? 'running' : 'paused' }} /></div>
          <div className={`pipe-node small ${state === 'thinking' ? 'on' : ''}`}>합성</div>
        </div>
      </div>
    </div>
  );
}

interface InterviewProps {
  persona: Persona;
  avatarStyle: AvatarStyle;
  orbColor: OrbColor;
  debugVisible: boolean;
  setDebugVisible: (fn: (d: boolean) => boolean) => void;
  forcedState: ForcedState;
  latencyMul: number;
  visionPreset: 'auto' | string[];
  onComplete: (result: InterviewResult) => void;
}

export default function Interview({
  persona,
  avatarStyle,
  orbColor,
  debugVisible,
  setDebugVisible,
  forcedState,
  onComplete,
}: InterviewProps) {
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [latency, setLatency] = useState<Latency>({ vad: 0, stt: 0, vision: 0, llm: 0, tts: 0 });
  const [captureFlash, setCaptureFlash] = useState(false);
  const [hasCapturedFrame, setHasCapturedFrame] = useState(false);
  const [streamingInterviewer, setStreamingInterviewer] = useState('');
  const [streamingCandidate, setStreamingCandidate] = useState('');
  const [hashimotoStrategy, setHashimotoStrategy] = useState<HashimotoStrategy | null>(null);
  const [hashimotoAnalyzing, setHashimotoAnalyzing] = useState(false);

  const inputAccumRef = useRef('');
  const outputAccumRef = useRef('');
  const turnStartRef = useRef<number | null>(null);
  const kickoffSentRef = useRef(false);
  // True from sendKickoff() until that turn's onTurnComplete fires. Gemini
  // STT can hallucinate Korean filler ("그는 그가 한 말을 후회했다.") from
  // the 100ms silent PCM the kickoff sends, so we drop input transcript on
  // the kickoff turn rather than letting it surface as a candidate utterance.
  const kickoffPendingRef = useRef(false);
  const completedRef = useRef(false);
  const candidateTurnCountRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const spatialAvatarRef = useRef<SpatialAvatarHandle | null>(null);
  // Stable ref so Hashimoto callbacks can read the latest transcript without
  // becoming stale closures.
  const transcriptLatestRef = useRef<TranscriptTurn[]>([]);

  const systemInstruction = useMemo(
    () => buildSystemInstruction(persona, hashimotoStrategy ?? undefined, transcriptLatestRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [persona, hashimotoStrategy],
  );

  // ── Hashimoto helpers ────────────────────────────────────────────────────

  const hashimotoInit = useCallback(async (resumeText: string) => {
    try {
      const res = await fetch('/api/hashimoto/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resume_text: resumeText, topic_count: 3 }),
      });
      if (!res.ok) throw new Error(`init ${res.status}`);
      console.log('[hashimoto] initialized', await res.json());
    } catch (e) {
      console.warn('[hashimoto] init failed (non-fatal):', e);
    }
  }, []);

  // Stable ref so the Hashimoto callback can call disconnect/connect without
  // capturing a stale session closure (session is defined after this callback).
  const sessionRef = useRef<{ disconnect: () => void; connect: () => Promise<void> } | null>(null);

  // Called after each non-kickoff candidate turn. Fetches strategy, updates
  // systemInstruction, and quietly reconnects so the next Gemini turn is
  // informed by the new strategy + full conversation history.
  const hashimotoProcessTurn = useCallback(
    async (sttText: string, nextTranscript: TranscriptTurn[]) => {
      setHashimotoAnalyzing(true);
      try {
        const res = await fetch('/api/hashimoto/process_turn', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stt_text: sttText, anxiety: 50, confidence: 50 }),
        });
        if (!res.ok) throw new Error(`process_turn ${res.status}`);
        const strategy = (await res.json()) as HashimotoStrategy;
        console.log('[hashimoto] strategy', strategy);

        // Update ref so the systemInstruction memo picks up the new transcript
        // before reconnect.
        transcriptLatestRef.current = nextTranscript;
        setHashimotoStrategy(strategy);
        // React will re-render with new systemInstruction on next tick.
        // queueMicrotask ensures connect() runs after the render cycle so
        // optsRef.current in useLiveSession has the updated systemInstruction.
        queueMicrotask(() => {
          sessionRef.current?.disconnect();
          void sessionRef.current?.connect();
        });
      } catch (e) {
        console.warn('[hashimoto] process_turn failed (non-fatal):', e);
        setHashimotoAnalyzing(false);
      }
    },
    [],
  );

  const session = useLiveSession({
    systemInstruction,
    onInputTranscript: text => {
      if (kickoffPendingRef.current) return;
      inputAccumRef.current += text;
      setStreamingCandidate(prev => prev + text);
    },
    onOutputTranscript: text => {
      outputAccumRef.current += text;
      setStreamingInterviewer(prev => prev + text);
    },
    onFirstAudio: () => {
      if (turnStartRef.current !== null) {
        const ttft = Date.now() - turnStartRef.current;
        setLatency(l => ({ ...l, llm: ttft }));
      }
    },
    // Forward Gemini's 24kHz Int16 PCM to SpatialReal ONLY when the 3D avatar
    // is the active style. Defining `onPcmChunk` bypasses useLiveSession's
    // PCMPlayer (to avoid echo with the SDK's own playback). When the avatar
    // is a legacy SVG style, we leave `onPcmChunk` undefined so PCMPlayer
    // handles audio normally — without this guard, switching to an SVG style
    // would silently break audio (consumer set + ref null = sink to nowhere).
    onPcmChunk:
      avatarStyle === 'spatialreal'
        ? b64 => {
            spatialAvatarRef.current?.pushPcm(b64);
          }
        : undefined,
    onTurnComplete: () => {
      // Drain animation frames on the avatar SDK if the spatialreal style is
      // active. No-op for SVG styles (ref is null + we didn't fork audio).
      if (avatarStyle === 'spatialreal') {
        spatialAvatarRef.current?.endRound();
      }

      const wasKickoff = kickoffPendingRef.current;
      kickoffPendingRef.current = false;

      const candidateText = wasKickoff ? '' : inputAccumRef.current.trim();
      const interviewerText = outputAccumRef.current.trim();
      inputAccumRef.current = '';
      outputAccumRef.current = '';
      setStreamingCandidate('');
      setStreamingInterviewer('');

      let nextTranscript: TranscriptTurn[] = [];
      setTranscript(prev => {
        const next = [...prev];
        if (candidateText) next.push({ role: 'candidate', text: candidateText });
        if (interviewerText) {
          const idx = next.filter(t => t.role === 'interviewer').length + 1;
          next.push({ role: 'interviewer', text: interviewerText, idx });
        }
        nextTranscript = next;
        return next;
      });

      // Call Hashimoto after each real candidate answer. Skip kickoff turns
      // and the last turn (interview about to complete).
      if (candidateText && !wasKickoff && !completedRef.current) {
        candidateTurnCountRef.current += 1;
        if (candidateTurnCountRef.current < persona.questions.length) {
          void hashimotoProcessTurn(candidateText, nextTranscript);
        }
      }
    },
    onError: err => {
      console.error('[live]', err);
    },
  });

  // Keep sessionRef in sync so hashimotoProcessTurn can call disconnect/connect.
  sessionRef.current = session;

  // Connect on mount + every persona change
  useEffect(() => {
    kickoffSentRef.current = false;
    kickoffPendingRef.current = false;
    completedRef.current = false;
    candidateTurnCountRef.current = 0;
    inputAccumRef.current = '';
    outputAccumRef.current = '';
    turnStartRef.current = null;
    transcriptLatestRef.current = [];
    setTranscript([]);
    setStreamingCandidate('');
    setStreamingInterviewer('');
    setLatency({ vad: 0, stt: 0, vision: 0, llm: 0, tts: 0 });
    setHasCapturedFrame(false);
    setHashimotoStrategy(null);
    setHashimotoAnalyzing(false);
    void hashimotoInit(persona.resume);
    void session.connect();
    return () => session.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.id]);

  // Kick off the interview once setup completes. Path B uses sendKickoff
  // (manual VAD zero-content turn) instead of sendText so text input does
  // not contaminate a manual-VAD session and trigger 1007 mid-interview.
  // After Hashimoto-triggered reconnects, kickoffSentRef stays true so we
  // don't re-kickoff — the session resumes in 'ready' state waiting for
  // the candidate's next answer.
  useEffect(() => {
    console.log('[interview] state=', session.state, 'kickoffSent=', kickoffSentRef.current);
    if (session.state === 'ready' && !kickoffSentRef.current) {
      kickoffSentRef.current = true;
      kickoffPendingRef.current = true;
      turnStartRef.current = Date.now();
      console.log('[interview] sending kickoff (manual VAD)');
      session.sendKickoff();
    }
    // Hashimoto reconnect completed — release the analyzing lock so the
    // candidate can start their next answer.
    if (session.state === 'ready' && hashimotoAnalyzing) {
      setHashimotoAnalyzing(false);
    }
  }, [session.state, session, hashimotoAnalyzing]);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  // Detect interview completion. Happy path: final candidate answer + closing
  // interviewer remark. Fallback: model may skip closing or veer into a 6th
  // question; if state stays 'ready' for 12s after the final answer we
  // force-complete with the current transcript. If the user starts another
  // turn (state leaves 'ready'), the timer is cancelled.
  useEffect(() => {
    if (completedRef.current) return;
    const candidateCount = transcript.filter(t => t.role === 'candidate').length;
    const interviewerCount = transcript.filter(t => t.role === 'interviewer').length;
    if (candidateCount < persona.questions.length) return;
    if (session.state !== 'ready') return;

    const haveClosing = interviewerCount > candidateCount;
    const delay = haveClosing ? 1200 : 12000;
    const snapshot = [...transcript];
    const t = setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      onComplete({ transcript: snapshot, latency, persona });
    }, delay);
    return () => clearTimeout(t);
  }, [transcript, persona.questions.length, session.state, latency, persona, onComplete]);

  const effectiveState: InterviewState =
    forcedState && forcedState !== 'auto'
      ? (forcedState as InterviewState)
      : mapSessionState(session.state);

  const startAnswer = async () => {
    if (session.state !== 'ready') return;
    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 380);
    setHasCapturedFrame(true);
    turnStartRef.current = Date.now();
    await session.startTurn();
  };

  const finishAnswer = () => {
    if (session.state !== 'listening') return;
    session.endTurn();
  };

  const interviewerCount = transcript.filter(t => t.role === 'interviewer').length;
  const turnIdx = Math.min(Math.max(0, interviewerCount - 1), persona.questions.length - 1);
  const currentQ = persona.questions[turnIdx] ?? persona.questions[0];

  const isReadyForAnswer = session.state === 'ready' && !completedRef.current && !hashimotoAnalyzing;
  const isConnecting = session.state === 'connecting' || session.state === 'idle';
  const isError = session.state === 'error';

  return (
    <div className="screen interview-screen-fixed">
      <div className="orb orb-mint atmospheric-orb" style={{ width: 380, height: 380, top: -140, left: '-6%' }} />
      <div className={`orb orb-${orbColor} atmospheric-orb`} style={{ width: 320, height: 320, bottom: -120, right: '-4%' }} />

      <div className="iv-frame">
        <div className="iv-subhead">
          <div className="progress-rail-compact">
            {persona.questions.map((q, i) => (
              <div key={i} className={`rail-step-c ${i < turnIdx ? 'done' : i === turnIdx ? 'active' : ''}`}>
                <span className="rail-num-c mono-xs">{String(i + 1).padStart(2, '0')}</span>
                <span className="rail-label-c">
                  {q.tone === 'baseline'
                    ? 'baseline'
                    : q.tone === 'probe-evidence'
                    ? 'evidence'
                    : q.tone === 'probe-thinking'
                    ? 'thinking'
                    : q.tone === 'tension'
                    ? 'tension'
                    : 'closing'}
                </span>
              </div>
            ))}
          </div>
          <div className="iv-subhead-right">
            <span className="caption-up" style={{ color: 'var(--muted)' }}>
              {persona.company.name} · {persona.company.role}
            </span>
            <button
              className={`btn btn-sm ${debugVisible ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setDebugVisible(d => !d)}
            >
              디버그 {debugVisible ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className={`iv-grid ${debugVisible ? 'with-debug' : ''}`}>
          <div className="iv-col iv-stage">
            <div className="iv-stage-card">
              <div className="stage-meta">
                <span className="caption-up">면접관</span>
                <StateBadge state={effectiveState} />
              </div>
              <div className="avatar-wrap-fixed">
                {avatarStyle === 'spatialreal' ? (
                  <SpatialAvatar ref={spatialAvatarRef} />
                ) : (
                  <Avatar style={avatarStyle} state={effectiveState} orbColor={orbColor} />
                )}
              </div>
            </div>
            <div className="iv-controls">
              <Waveform active={effectiveState === 'listening'} />
              <div className="record-actions">
                {isError && (
                  <button className="btn btn-outline btn-lg" onClick={() => session.connect()}>
                    재연결
                  </button>
                )}
                {!isError && isConnecting && (
                  <button className="btn btn-outline btn-lg" disabled>
                    연결 중…
                  </button>
                )}
                {!isError && !isConnecting && isReadyForAnswer && (
                  <button className="btn btn-primary btn-lg" onClick={startAnswer}>
                    <span className="rec-dot" /> 답변 시작
                  </button>
                )}
                {session.state === 'listening' && (
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={finishAnswer}
                    style={{ background: 'var(--error)' }}
                  >
                    <span className="rec-square" /> 답변 종료
                  </button>
                )}
                {session.state === 'thinking' && (
                  <button className="btn btn-outline btn-lg" disabled>
                    분석 중…
                  </button>
                )}
                {session.state === 'speaking' && (
                  <button className="btn btn-outline btn-lg" disabled>
                    면접관 발화 중…
                  </button>
                )}
              </div>
              <div className="record-hint caption">
                {isError && session.lastError && (
                  <span style={{ color: 'var(--error)' }}>오류: {session.lastError}</span>
                )}
                {!isError && isConnecting && 'Gemini Live API에 연결 중…'}
                {!isError && session.state === 'ready' && !kickoffSentRef.current && '세션 준비됨, 첫 질문 요청 중…'}
                {!isError && session.state === 'ready' && hashimotoAnalyzing && 'Hashimoto 전략 분석 중…'}
                {!isError && isReadyForAnswer && kickoffSentRef.current && 'Space 또는 버튼을 눌러 답변을 시작하세요.'}
                {session.state === 'listening' && '발화 중. 영상 프레임이 1초 간격으로 송신됨.'}
                {session.state === 'thinking' && 'Live API가 답변과 영상을 분석 중.'}
                {session.state === 'speaking' && '면접관이 다음 질문을 음성으로 전달 중.'}
              </div>
            </div>
          </div>

          <div className="iv-col iv-center">
            <div className="iv-question-card">
              <div className="q-meta">
                <span className="q-num mono-sm">
                  Q{Math.min(turnIdx + 1, persona.questions.length)}{' '}
                  <span style={{ color: 'var(--muted-soft)' }}>/ {persona.questions.length}</span>
                </span>
                <span className="caption-up" style={{ color: 'var(--muted)' }}>{currentQ.tone}</span>
              </div>
              <p className="display-md q-text-fixed">
                {streamingInterviewer
                  || transcript.filter(t => t.role === 'interviewer').slice(-1)[0]?.text
                  || (interviewerCount === 0 ? '연결 대기 중…' : currentQ.text)}
              </p>
            </div>

            <div className="iv-transcript-card">
              <div className="transcript-head">
                <span className="caption-up">대화 기록</span>
                <span className="mono-xs" style={{ color: 'var(--muted)' }}>{transcript.length} turns</span>
              </div>
              <div className="transcript-scroll" ref={transcriptRef}>
                {transcript.map((t, i) => (
                  <div key={i} className={`tr-row tr-${t.role}`}>
                    <span className="caption-up tr-who">
                      {t.role === 'interviewer' ? '면접관' : '지원자'}{t.idx ? ` · Q${t.idx}` : ''}
                    </span>
                    <p className="body-sm tr-text">{t.text}</p>
                  </div>
                ))}
                {streamingCandidate && (
                  <div className="tr-row tr-candidate" style={{ opacity: 0.7 }}>
                    <span className="caption-up tr-who">지원자 · 입력 중</span>
                    <p className="body-sm tr-text">{streamingCandidate}</p>
                  </div>
                )}
                {streamingInterviewer && transcript.length > 0 && (
                  <div className="tr-row tr-interviewer" style={{ opacity: 0.7 }}>
                    <span className="caption-up tr-who">면접관 · 발화 중</span>
                    <p className="body-sm tr-text">{streamingInterviewer}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {debugVisible && (
            <div className="iv-col iv-debug fade-up">
              <VisionPanel captured={hasCapturedFrame} captureFlash={captureFlash} />
              <LatencyBars ttft={latency.llm} />
              <Pipeline state={effectiveState} />
              <HashimotoPanel strategy={hashimotoStrategy} analyzing={hashimotoAnalyzing} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
