import type { OrbColor, Persona } from '../types';

interface PreInterviewProps {
  persona: Persona;
  orbColor: OrbColor;
  onStart: () => void;
}

export default function PreInterview({ persona, orbColor, onStart }: PreInterviewProps) {
  return (
    <div className="screen pre-screen fade-in">
      <div className="pre-hero">
        <div className="pre-hero-orbs" aria-hidden="true">
          <div className="orb orb-mint" style={{ width: 380, height: 380, top: -120, left: '20%' }} />
          <div className={`orb orb-${orbColor}`} style={{ width: 340, height: 340, top: 40, right: '15%' }} />
        </div>
        <div className="container pre-hero-inner">
          <span className="caption-up">A live interview · 1 turn end-to-end</span>
          <h1 className="display-mega" style={{ marginTop: 18, marginBottom: 24, maxWidth: 880, textWrap: 'pretty' }}>
            오늘은 짧은 면접 한 번을<br />함께 진행해볼게요.
          </h1>
          <p className="body-md" style={{ maxWidth: 620, marginBottom: 40 }}>
            면접관은 당신의 음성과, 발화 시작 직후 캡처된 한 프레임을 동시에 보고 다음 질문을 만듭니다.
            5분 안에 5개의 질문이 이어집니다.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn btn-primary btn-lg" onClick={onStart}>면접 시작하기</button>
            <button className="btn btn-outline btn-lg">시연 영상 보기</button>
          </div>
        </div>
      </div>

      <div className="container pre-grid">
        <div className="pre-grid-left">
          <div className="card pre-card">
            <div className="pre-card-head">
              <span className="caption-up">지원자</span>
              <span className="badge badge-dot">로드됨</span>
            </div>
            <h2 className="display-md" style={{ margin: '20px 0 4px' }}>{persona.candidate.name}</h2>
            <div className="caption" style={{ marginBottom: 24 }}>
              {persona.candidate.position} · {persona.candidate.school}
            </div>
            <hr className="hr" />
            <div className="caption-up" style={{ marginTop: 24, marginBottom: 14 }}>자기소개서</div>
            <div className="resume-body">
              {persona.resume.split('\n\n').map((p, i) => (
                <p key={i} className="body-md" style={{ marginTop: 0, marginBottom: 14, color: 'var(--body)' }}>{p}</p>
              ))}
            </div>
            <hr className="hr" style={{ margin: '24px 0' }} />
            <div className="caption-up" style={{ marginBottom: 14 }}>
              추출된 명제{' '}
              <span style={{ color: 'var(--muted-soft)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                · 면접관이 검증할 가설
              </span>
            </div>
            <ul className="proposition-list">
              {persona.propositions.map((p, i) => (
                <li key={i}>
                  <span className="prop-num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="body-strong">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pre-grid-right">
          <div className="card pre-card">
            <div className="pre-card-head">
              <span className="caption-up">지원 회사</span>
            </div>
            <h3 className="display-sm" style={{ margin: '14px 0 4px' }}>{persona.company.name}</h3>
            <div className="caption" style={{ marginBottom: 18 }}>{persona.company.team} · {persona.company.role}</div>
            <pre className="job-jd">{persona.job}</pre>
          </div>

          <div className="card-soft pre-precheck" style={{ marginTop: 24, position: 'relative', overflow: 'hidden' }}>
            <div className="orb orb-sky" style={{ width: 240, height: 240, top: -80, right: -60 }} />
            <span className="caption-up">시작 전 확인</span>
            <h3 className="display-sm" style={{ margin: '14px 0 20px' }}>장비 점검</h3>
            <div className="check-row"><span className="check-dot done" />마이크 · 정상 입력</div>
            <div className="check-row"><span className="check-dot done" />웹캠 · 정면 캡처 가능</div>
            <div className="check-row"><span className="check-dot done" />네트워크 · 24Mbps↑</div>
            <div className="check-row"><span className="check-dot pending" />비전 모델 · 워밍업 중</div>
          </div>

          <div className="pre-meta">
            <div className="pre-meta-row"><span className="caption-up">예상 소요</span><span className="mono-sm">5–7 min</span></div>
            <div className="pre-meta-row"><span className="caption-up">질문 수</span><span className="mono-sm">5</span></div>
            <div className="pre-meta-row"><span className="caption-up">목표 latency</span><span className="mono-sm">p50 &lt; 8s</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
