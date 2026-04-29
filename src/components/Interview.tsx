import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { MOCK_RESPONSES } from '../data';
import type {
  AvatarStyle,
  ForcedState,
  InterviewState,
  Latency,
  OrbColor,
  Persona,
  TranscriptTurn,
  InterviewResult,
} from '../types';

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

function VisionKeywords({ keywords, captureFlash }: { keywords: string[]; captureFlash: boolean }) {
  return (
    <div className="vision-card">
      <div className="vision-head">
        <span className="caption-up">비전 분석</span>
        <span className="mono-xs" style={{ color: 'var(--muted)' }}>1 frame · Flash</span>
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
          {keywords.length === 0 && (
            <span className="caption" style={{ color: 'var(--muted-soft)', fontSize: 12 }}>
              발화 시 1프레임 캡처…
            </span>
          )}
          {keywords.map((k, i) => (
            <span
              key={`${k}-${i}`}
              className="vision-keyword fade-up"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LatencyBars({ values }: { values: Latency }) {
  const max = 4000;
  const items = [
    { key: 'vad', label: 'VAD', v: values.vad, parallel: false },
    { key: 'stt', label: 'STT', v: values.stt, parallel: false },
    { key: 'vision', label: 'Vision', v: values.vision, parallel: true },
    { key: 'llm', label: 'LLM', v: values.llm, parallel: false },
    { key: 'tts', label: 'TTS', v: values.tts, parallel: false },
  ];
  const total = values.vad + values.stt + Math.max(0, values.llm) + values.tts;
  return (
    <div className="latency-block">
      <div className="latency-head">
        <span className="caption-up">Latency</span>
        <span className="mono-sm" style={{ color: 'var(--ink)' }}>{(total / 1000).toFixed(1)}s</span>
      </div>
      <div className="latency-list">
        {items.map(it => (
          <div key={it.key} className={`latency-row ${it.parallel ? 'parallel' : ''}`}>
            <span className="latency-label">{it.label}</span>
            <div className="latency-bar">
              <span className="latency-bar-fill" style={{ width: `${Math.min(100, (it.v / max) * 100)}%` }} />
            </div>
            <span className="mono-xs latency-val">
              {it.v}
              <span style={{ color: 'var(--muted-soft)' }}>ms</span>
            </span>
          </div>
        ))}
      </div>
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
        <div className={`pipe-node ${state === 'thinking' ? 'on' : ''}`}>STT</div>
        <div className="pipe-edge"><span style={{ animationPlayState: state === 'thinking' ? 'running' : 'paused' }} /></div>
        <div className={`pipe-node ${state === 'thinking' ? 'on' : ''}`}>LLM</div>
        <div className="pipe-edge"><span style={{ animationPlayState: state === 'thinking' ? 'running' : 'paused' }} /></div>
        <div className={`pipe-node ${state === 'speaking' ? 'on' : ''}`}>TTS</div>
      </div>
      <div className="pipe-parallel">
        <div className="pipe-parallel-inner">
          <div className={`pipe-node small ${state === 'listening' || state === 'thinking' ? 'on' : ''}`}>Frame</div>
          <div className="pipe-edge small"><span style={{ animationPlayState: state === 'listening' || state === 'thinking' ? 'running' : 'paused' }} /></div>
          <div className={`pipe-node small ${state === 'thinking' ? 'on' : ''}`}>Vision</div>
          <div className="pipe-edge small"><span style={{ animationPlayState: state === 'thinking' ? 'running' : 'paused' }} /></div>
          <div className={`pipe-node small ${state === 'thinking' ? 'on' : ''}`}>키워드</div>
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
  latencyMul,
  visionPreset,
  onComplete,
}: InterviewProps) {
  const [turn, setTurn] = useState(0);
  const [state, setState] = useState<InterviewState>('speaking');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [captureFlash, setCaptureFlash] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [currentQ, setCurrentQ] = useState(persona.questions[0]);
  const [latency, setLatency] = useState<Latency>({ vad: 120, stt: 1400, vision: 580, llm: 1100, tts: 760 });
  const [showVisionAdjust, setShowVisionAdjust] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setTurn(0);
    setCurrentQ(persona.questions[0]);
    setState('speaking');
    setTranscript([{ role: 'interviewer', text: persona.questions[0].text, idx: 1 }]);
    setKeywords([]);
    setShowVisionAdjust(false);
    const t = setTimeout(() => setState('idle'), 2400);
    timersRef.current.push(t);
    return () => timersRef.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.id]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const effectiveState: InterviewState =
    forcedState && forcedState !== 'auto' ? (forcedState as InterviewState) : state;

  const startAnswer = () => {
    if (state !== 'idle') return;
    setState('listening');
    setCaptureFlash(true);
    setKeywords([]);
    setTimeout(() => setCaptureFlash(false), 380);
    const frame =
      visionPreset === 'auto'
        ? persona.visionFrames[turn]
        : (visionPreset as string[]);
    frame.forEach((kw, i) => {
      const t = setTimeout(() => setKeywords(k => [...k, kw]), 400 + i * 380);
      timersRef.current.push(t);
    });
  };

  const finishAnswer = () => {
    if (state !== 'listening') return;
    setState('thinking');
    const resp = (MOCK_RESPONSES[persona.id] || [])[turn] || '...';
    setTranscript(t => [...t, { role: 'candidate', text: resp }]);
    const m = latencyMul;
    const lat: Latency = {
      vad: Math.round(120 * m),
      stt: Math.round((1300 + Math.random() * 300) * m),
      vision: Math.round((520 + Math.random() * 200) * m),
      llm: Math.round((1000 + Math.random() * 400) * m),
      tts: Math.round((720 + Math.random() * 200) * m),
    };
    setLatency(lat);
    const total = lat.vad + lat.stt + lat.llm + lat.tts;
    const t1 = setTimeout(() => {
      const next = turn + 1;
      if (next >= persona.questions.length) {
        setState('idle');
        const t2 = setTimeout(
          () =>
            onComplete({
              transcript: [...transcript, { role: 'candidate', text: resp }],
              latency: lat,
              persona,
            }),
          800
        );
        timersRef.current.push(t2);
        return;
      }
      const q = persona.questions[next];
      setCurrentQ(q);
      setTurn(next);
      setState('speaking');
      setShowVisionAdjust(!!q.visionAdjusted);
      setTranscript(t => [
        ...t,
        { role: 'interviewer', text: q.text, idx: next + 1, visionAdjusted: q.visionAdjusted },
      ]);
      const t3 = setTimeout(() => {
        setState('idle');
        setKeywords([]);
      }, 2200);
      timersRef.current.push(t3);
    }, Math.min(2400, total / 2));
    timersRef.current.push(t1);
  };

  return (
    <div className="screen interview-screen-fixed">
      <div className="orb orb-mint atmospheric-orb" style={{ width: 380, height: 380, top: -140, left: '-6%' }} />
      <div className={`orb orb-${orbColor} atmospheric-orb`} style={{ width: 320, height: 320, bottom: -120, right: '-4%' }} />

      <div className="iv-frame">
        <div className="iv-subhead">
          <div className="progress-rail-compact">
            {persona.questions.map((q, i) => (
              <div key={i} className={`rail-step-c ${i < turn ? 'done' : i === turn ? 'active' : ''}`}>
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
            <button className={`btn btn-sm ${debugVisible ? 'btn-primary' : 'btn-outline'}`} onClick={() => setDebugVisible(d => !d)}>
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
                <Avatar style={avatarStyle} state={effectiveState} orbColor={orbColor} />
              </div>
            </div>
            <div className="iv-controls">
              <Waveform active={effectiveState === 'listening'} />
              <div className="record-actions">
                {effectiveState === 'idle' && (
                  <button className="btn btn-primary btn-lg" onClick={startAnswer}>
                    <span className="rec-dot" /> 답변 시작
                  </button>
                )}
                {effectiveState === 'listening' && (
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={finishAnswer}
                    style={{ background: 'var(--error)' }}
                  >
                    <span className="rec-square" /> 답변 종료
                  </button>
                )}
                {effectiveState === 'thinking' && (
                  <button className="btn btn-outline btn-lg" disabled>분석 중…</button>
                )}
                {effectiveState === 'speaking' && (
                  <button className="btn btn-outline btn-lg" disabled>면접관 발화 중…</button>
                )}
              </div>
              <div className="record-hint caption">
                {effectiveState === 'idle' && 'Space 또는 버튼을 눌러 답변을 시작하세요.'}
                {effectiveState === 'listening' && '발화 직후 1프레임 캡처 → 비전 분석 시작.'}
                {effectiveState === 'thinking' && 'STT · 비전 · 자소서 컨텍스트 합성 중.'}
                {effectiveState === 'speaking' && '면접관이 다음 질문을 음성으로 전달 중.'}
              </div>
            </div>
          </div>

          <div className="iv-col iv-center">
            <div className="iv-question-card">
              <div className="q-meta">
                <span className="q-num mono-sm">
                  Q{turn + 1} <span style={{ color: 'var(--muted-soft)' }}>/ {persona.questions.length}</span>
                </span>
                <span className="caption-up" style={{ color: 'var(--muted)' }}>{currentQ.tone}</span>
              </div>
              <p className="display-md q-text-fixed">{currentQ.text}</p>
              {showVisionAdjust && currentQ.visionAdjusted && (
                <div className="vision-adjust fade-up">
                  <span className="caption-up">비전 기반 톤 조정</span>
                  <span className="body-sm" style={{ color: 'var(--ink)', fontStyle: 'italic' }}>
                    "{currentQ.visionAdjusted}"
                  </span>
                </div>
              )}
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
                    {t.visionAdjusted && <span className="tr-vision-tag mono-xs">↳ vision-adjusted</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {debugVisible && (
            <div className="iv-col iv-debug fade-up">
              <VisionKeywords keywords={keywords} captureFlash={captureFlash} />
              <LatencyBars values={latency} />
              <Pipeline state={effectiveState} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
