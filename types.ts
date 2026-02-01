
export enum Difficulty {
  Easy = 'Easy',
  Medium = 'Medium',
  Hard = 'Hard',
}

export type EvaluationMode = 'LLM' | 'FALLBACK_RULE_BASED';

export interface Skill {
  name: string;
  level: 'Junior' | 'Mid' | 'Senior';
}

export interface ResumeData {
  candidateName: string;
  skills: Skill[];
  experienceYears: number;
  primaryRole: string;
}

export interface JobDescriptionData {
  roleTitle: string;
  // Split skills for Critical vs Optional logic
  primarySkills: string[];
  secondarySkills: string[]; 
  complexityLevel: 'Junior' | 'Mid' | 'Senior';
  description: string;
}

export interface Question {
  id: string;
  text: string;
  targetSkill: string;
  difficulty: Difficulty;
  expectedKeywords: string[];
}

export interface EvaluationCriteria {
  accuracy: number; // 0-10
  clarity: number; // 0-10
  depth: number; // 0-10
  relevance: number; // 0-10
}

export interface AnswerEvaluation extends EvaluationCriteria {
  totalScore: number; // Weighted sum before penalty
  feedback: string;
  timeTakenSeconds: number;
  timePenalty: number;
  finalScore: number; // After penalty
  skillGapPenalty?: number; // Penalty for missing critical skills
  isFallback?: boolean; // True if deterministic evaluator was used
}

export interface InterviewTurn {
  question: Question;
  answer: string;
  evaluation: AnswerEvaluation;
  difficultyBefore: Difficulty;
  difficultyAfter: Difficulty;
  timestamp: number;
  criticalFailure: boolean; // True if score < 2.0
}

export interface InterviewState {
  status: 'IDLE' | 'ANALYZING' | 'GENERATING' | 'INTERVIEWING' | 'EVALUATING' | 'TERMINATED' | 'COMPLETED';
  currentDifficulty: Difficulty;
  evaluationMode: EvaluationMode; // Tracks if we are running on AI or Fallback
  activeQuestion: Question | null; // The question currently "in play"
  turns: InterviewTurn[];
  scoreHistory: number[];
  
  // Termination Counters
  consecutiveWeakAnswers: number;
  timeViolations: number;
  
  // Gap Analysis
  detectedSkillGaps: { skill: string; type: 'PRIMARY' | 'SECONDARY' }[];
  difficultyCeiling: Difficulty | null; // Constraint based on resume
  
  terminationReason: string | null;
  logs: string[]; // System logs for audit
  config: {
    maxQuestions: number;
    timeLimitPerQuestion: number;
    passingScoreThreshold: number;
    maxViolations: number;
  };
}
