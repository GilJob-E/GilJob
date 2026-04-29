import type { AvatarStyle, InterviewState, OrbColor } from '../types';

interface AvatarProps {
  style: AvatarStyle;
  state: InterviewState;
  orbColor: OrbColor;
}

export default function Avatar({ style, state, orbColor }: AvatarProps) {
  const orbVar = `var(--grad-${orbColor})`;

  if (style === 'illustration') {
    return (
      <div className={`avatar avatar-illust state-${state}`}>
        <svg viewBox="0 0 240 240" width="100%" height="100%" aria-hidden="true">
          <defs>
            <radialGradient id="bg" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor={orbVar} stopOpacity="0.9" />
              <stop offset="100%" stopColor={orbVar} stopOpacity="0" />
            </radialGradient>
            <linearGradient id="suit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3a3633" />
              <stop offset="1" stopColor="#1c1917" />
            </linearGradient>
          </defs>
          <rect width="240" height="240" fill="var(--canvas-soft)" />
          <circle cx="120" cy="100" r="120" fill="url(#bg)" />
          <path d="M30 240 Q30 180 90 165 L150 165 Q210 180 210 240 Z" fill="url(#suit)" />
          <rect x="106" y="140" width="28" height="30" fill="#d6b89c" />
          <ellipse cx="120" cy="115" rx="46" ry="54" fill="#e2c4a6" />
          <path d="M74 102 Q78 60 120 56 Q162 60 166 102 Q166 80 150 70 Q138 64 120 64 Q102 64 90 70 Q74 80 74 102 Z" fill="#1c1917" />
          <ellipse cx="104" cy="118" rx="3" ry={state === 'thinking' ? 1 : 3.5} fill="#0c0a09" className="eye" />
          <ellipse cx="136" cy="118" rx="3" ry={state === 'thinking' ? 1 : 3.5} fill="#0c0a09" className="eye" />
          <path d={state === 'thinking' ? 'M96 108 L114 110' : 'M96 110 L114 108'} stroke="#1c1917" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d={state === 'thinking' ? 'M126 110 L144 108' : 'M126 108 L144 110'} stroke="#1c1917" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M120 122 L116 134 L124 134 Z" fill="#c9a384" opacity="0.6" />
          <g className="mouth">
            {state === 'speaking' ? (
              <ellipse cx="120" cy="146" rx="7" ry="4" fill="#5a3a32" />
            ) : state === 'listening' ? (
              <path d="M110 146 Q120 150 130 146" stroke="#5a3a32" strokeWidth="2" fill="none" strokeLinecap="round" />
            ) : (
              <path d="M110 146 L130 146" stroke="#5a3a32" strokeWidth="2" fill="none" strokeLinecap="round" />
            )}
          </g>
          <path d="M90 170 L120 192 L150 170 L150 200 L90 200 Z" fill="#f5f5f5" />
          <path d="M120 192 L120 230" stroke="#1c1917" strokeWidth="2" />
        </svg>
      </div>
    );
  }

  if (style === 'orb') {
    return (
      <div className={`avatar avatar-orb state-${state}`}>
        <div className="orb-core" style={{ background: `radial-gradient(circle at 35% 35%, ${orbVar}, transparent 70%)` }} />
        <div className="orb-ring" />
        <div className="orb-ring orb-ring-2" />
      </div>
    );
  }

  if (style === 'geometric') {
    return (
      <div className={`avatar avatar-geo state-${state}`}>
        <svg viewBox="0 0 240 240" width="100%" height="100%">
          <defs>
            <radialGradient id="geog" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor={orbVar} stopOpacity="0.6" />
              <stop offset="100%" stopColor={orbVar} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="240" height="240" fill="var(--canvas-soft)" />
          <circle cx="120" cy="120" r="120" fill="url(#geog)" />
          <circle cx="120" cy="120" r="60" fill="none" stroke="var(--ink)" strokeWidth="1" />
          <circle cx="120" cy="120" r="40" fill="none" stroke="var(--ink)" strokeWidth="1" opacity="0.5" />
          <circle cx="120" cy="120" r="20" fill="var(--ink)" className="geo-dot" />
          <line x1="0" y1="120" x2="240" y2="120" stroke="var(--ink)" strokeWidth="0.5" opacity="0.3" />
          <line x1="120" y1="0" x2="120" y2="240" stroke="var(--ink)" strokeWidth="0.5" opacity="0.3" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`avatar avatar-initial state-${state}`}>
      <div className="initial-bg" style={{ background: `radial-gradient(circle at 50% 40%, ${orbVar}, transparent 70%)` }} />
      <div className="initial-letters" style={{ fontFamily: 'var(--display)' }}>I</div>
    </div>
  );
}
