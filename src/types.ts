export type AvatarStyle = 'illustration' | 'orb' | 'geometric' | 'initial';
export type OrbColor = 'mint' | 'peach' | 'lavender' | 'sky' | 'rose';
export type Theme = 'light' | 'dark';
export type InterviewState = 'idle' | 'listening' | 'thinking' | 'speaking';
export type ForcedState = InterviewState | 'auto';

export type QuestionTone =
  | 'baseline'
  | 'probe-evidence'
  | 'probe-thinking'
  | 'tension'
  | 'closing';

export interface Question {
  idx: number;
  text: string;
  tone: QuestionTone;
  visionAdjusted?: string;
}

export interface Persona {
  id: string;
  company: { name: string; role: string; team: string };
  candidate: { name: string; position: string; school: string };
  resume: string;
  job: string;
  propositions: string[];
  questions: Question[];
  visionFrames: string[][];
}

export interface TranscriptTurn {
  role: 'interviewer' | 'candidate';
  text: string;
  idx?: number;
  visionAdjusted?: string;
}

export interface Latency {
  vad: number;
  stt: number;
  vision: number;
  llm: number;
  tts: number;
}

export interface InterviewResult {
  transcript: TranscriptTurn[];
  latency: Latency;
  persona: Persona;
}
