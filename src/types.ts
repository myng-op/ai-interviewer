export interface Question {
  id: string;
  content: string;
  type: string;
  requirement: string;
  condition: string;
  max_sec: number;
}

/** Raw shape of a single question in the JSON file */
export interface RawQuestion {
  content: string;
  type: string;
  requirement: string;
  condition: string;
  max_sec: number;
}

/** Shape of the interview script JSON file (keys like "q1", "q2", …) */
export type InterviewScript = Record<string, RawQuestion>;

export interface InterviewMessage {
  id: string;
  role: 'interviewer' | 'candidate';
  text: string;
  timestamp: number;
  audioUrl?: string;
}

export interface InterviewState {
  status: 'idle' | 'configuring' | 'active' | 'completed';
  currentQuestionIndex: number;
  messages: InterviewMessage[];
  questions: Question[];
  totalTimeSec: number;
  startTime?: number;
}
