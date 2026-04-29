import { useEffect, useState } from 'react';
import PreInterview from './components/PreInterview';
import Interview from './components/Interview';
import Results from './components/Results';
import { PERSONAS } from './data';
import type { AvatarStyle, ForcedState, InterviewResult, OrbColor, Theme } from './types';

type Stage = 'pre' | 'interview' | 'results';

const DEFAULTS = {
  avatarStyle: 'illustration' as AvatarStyle,
  orbColor: 'lavender' as OrbColor,
  theme: 'light' as Theme,
  forcedState: 'auto' as ForcedState,
  latencyMul: 1,
  visionPreset: 'auto' as 'auto' | string[],
  personaId: 'toss_pm',
};

export default function App() {
  const [personaId, setPersonaId] = useState<string>(DEFAULTS.personaId);
  const [stage, setStage] = useState<Stage>('pre');
  const [result, setResult] = useState<InterviewResult | null>(null);
  const [debugVisible, setDebugVisible] = useState(false);
  const [theme] = useState<Theme>(DEFAULTS.theme);

  const persona = PERSONAS[personaId] ?? PERSONAS.toss_pm;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    setStage('pre');
    setResult(null);
  }, [personaId]);

  return (
    <div className="app">
      <nav className="top-nav">
        <div className="brand" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
          <span className="brand-dot" />
          <span style={{ whiteSpace: 'nowrap' }}>GilJob-E</span>
          <span
            className="caption-up"
            style={{
              marginLeft: 14,
              padding: '4px 10px',
              background: 'var(--surface-strong)',
              borderRadius: 999,
              fontSize: 11,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            5/1 demo · build 003
          </span>
        </div>
        <div className="nav-step-row">
          <span className={`nav-step ${stage === 'pre' ? 'active' : 'done'}`}>
            <span className="nav-step-num">01</span>준비
          </span>
          <span className="nav-step-divider" />
          <span className={`nav-step ${stage === 'interview' ? 'active' : stage === 'results' ? 'done' : ''}`}>
            <span className="nav-step-num">02</span>면접
          </span>
          <span className="nav-step-divider" />
          <span className={`nav-step ${stage === 'results' ? 'active' : ''}`}>
            <span className="nav-step-num">03</span>결과
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <PersonaSwitch personaId={personaId} onChange={setPersonaId} />
        </div>
      </nav>

      {stage === 'pre' && (
        <PreInterview persona={persona} orbColor={DEFAULTS.orbColor} onStart={() => setStage('interview')} />
      )}

      {stage === 'interview' && (
        <Interview
          persona={persona}
          avatarStyle={DEFAULTS.avatarStyle}
          orbColor={DEFAULTS.orbColor}
          debugVisible={debugVisible}
          setDebugVisible={setDebugVisible}
          forcedState={DEFAULTS.forcedState}
          latencyMul={DEFAULTS.latencyMul}
          visionPreset={DEFAULTS.visionPreset}
          onComplete={r => {
            setResult(r);
            setStage('results');
          }}
        />
      )}

      {stage === 'results' && (
        <Results
          result={
            result ?? {
              transcript: [],
              latency: { vad: 120, stt: 1400, vision: 0, llm: 1100, tts: 760 },
            }
          }
          persona={persona}
          orbColor={DEFAULTS.orbColor}
          onRestart={() => {
            setStage('pre');
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

function PersonaSwitch({ personaId, onChange }: { personaId: string; onChange: (id: string) => void }) {
  const items = [
    { id: 'toss_pm', label: 'PM' },
    { id: 'kakao_be', label: 'BE' },
    { id: 'naver_design', label: 'PD' },
  ];
  return (
    <div className="persona-switch" title="페르소나 전환">
      {items.map(it => (
        <button
          key={it.id}
          className={`persona-chip ${personaId === it.id ? 'active' : ''}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
