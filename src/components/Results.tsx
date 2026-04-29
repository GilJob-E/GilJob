import type { InterviewResult, OrbColor, Persona } from '../types';

interface ResultsProps {
  result: InterviewResult | { transcript: never[]; latency: { vad: number; stt: number; llm: number; tts: number; vision?: number } };
  persona: Persona;
  orbColor: OrbColor;
  onRestart: () => void;
}

export default function Results({ result, persona, orbColor, onRestart }: ResultsProps) {
  const transcript = (result?.transcript ?? []) as InterviewResult['transcript'];
  const latency = (result?.latency ?? { vad: 0, stt: 0, vision: 0, llm: 0, tts: 0 }) as InterviewResult['latency'];
  const total = (latency.vad || 0) + (latency.stt || 0) + (latency.llm || 0) + (latency.tts || 0);

  return (
    <div className="screen results-screen fade-in">
      <div className="orb orb-rose atmospheric-orb" style={{ width: 420, height: 420, top: -140, right: '5%' }} />
      <div className={`orb orb-${orbColor} atmospheric-orb`} style={{ width: 320, height: 320, bottom: 0, left: '-5%' }} />
      <div className="container">
        <div className="results-head">
          <span className="caption-up">Interview complete · 5/5 questions</span>
          <h1 className="display-mega" style={{ marginTop: 16, marginBottom: 16, maxWidth: 880, textWrap: 'pretty' }}>
            {persona.candidate.name}님 면접이<br />마무리됐어요.
          </h1>
          <p className="body-md" style={{ maxWidth: 580 }}>
            아래 기록은 5/1 데모용 mock 데이터로 생성되었습니다. 실제 배포본에서는 latency·비전 키워드·LLM 컨텍스트가 모두 server-side에서 측정됩니다.
          </p>
        </div>

        <div className="results-grid">
          <div className="results-col">
            <div className="card results-metric-card">
              <span className="caption-up">전체 latency · 마지막 턴</span>
              <div className="metric-mega">
                <span className="display-mega" style={{ fontSize: 80 }}>{(total / 1000).toFixed(1)}</span>
                <span className="display-sm" style={{ color: 'var(--muted)' }}>s</span>
              </div>
              <div className="metric-bar-stack">
                {[
                  { k: 'VAD', v: latency.vad, c: 'mint' },
                  { k: 'STT', v: latency.stt, c: 'sky' },
                  { k: 'LLM', v: latency.llm, c: 'lavender' },
                  { k: 'TTS', v: latency.tts, c: 'peach' },
                ].map(s => (
                  <div key={s.k} className="metric-bar-row">
                    <span className="caption-up" style={{ width: 56 }}>{s.k}</span>
                    <div className="metric-bar"><span style={{ width: `${total > 0 ? (s.v / total) * 100 : 0}%`, background: `var(--grad-${s.c})` }} /></div>
                    <span className="mono-sm" style={{ width: 64, textAlign: 'right' }}>{s.v}ms</span>
                  </div>
                ))}
              </div>
              <div className="metric-note caption" style={{ marginTop: 20 }}>
                목표 p50 &lt; 8000ms ·{' '}
                {total < 8000 ? <span style={{ color: 'var(--success)' }}>달성</span> : <span style={{ color: 'var(--error)' }}>초과</span>}
              </div>
            </div>

            <div className="card">
              <span className="caption-up">비전 분석 기여</span>
              <h3 className="display-sm" style={{ margin: '14px 0 16px' }}>1프레임 병렬화로 추가된 신호</h3>
              <div className="vision-contrib-list">
                {persona.visionFrames.map((frame, i) => (
                  <div key={i} className="vc-row">
                    <span className="mono-xs" style={{ color: 'var(--muted)', width: 32 }}>Q{i + 1}</span>
                    <div className="vc-keywords">
                      {frame.map((k, j) => <span key={j} className="vc-kw">{k}</span>)}
                    </div>
                    {persona.questions[i]?.visionAdjusted && <span className="vc-mark">↳ tone</span>}
                  </div>
                ))}
              </div>
              <div className="caption" style={{ marginTop: 18 }}>
                위 키워드들은 LLM 시스템 프롬프트에 합쳐져 다음 질문 생성에 사용되었습니다. 톤 조정이 일어난 턴은 우측에 표시됩니다.
              </div>
            </div>
          </div>

          <div className="results-col">
            <div className="card transcript-card-full">
              <span className="caption-up">대화 기록 · 전체</span>
              <div className="transcript transcript-full" style={{ marginTop: 14 }}>
                {transcript.map((t, i) => (
                  <div key={i} className={`tr-row tr-${t.role}`}>
                    <span className="caption-up tr-who">
                      {t.role === 'interviewer' ? '면접관' : '지원자'}{t.idx ? ` · Q${t.idx}` : ''}
                    </span>
                    <p className="body-md tr-text">{t.text}</p>
                    {t.visionAdjusted && <span className="tr-vision-tag mono-xs">↳ vision-adjusted: "{t.visionAdjusted}"</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="results-cta">
          <button className="btn btn-primary btn-lg" onClick={onRestart}>다시 시작</button>
          <button className="btn btn-outline btn-lg">JSON 내보내기</button>
          <button className="btn btn-ghost">데모 노트 보기</button>
        </div>
      </div>
    </div>
  );
}
