
import { Difficulty, InterviewState, InterviewTurn, AnswerEvaluation, JobDescriptionData, ResumeData, EvaluationCriteria, Question } from "../types";
import { INTERVIEW_POLICY } from "./policy";
import { evaluateAnswer } from "./gemini";

// ============================================================================
// PURE DETERMINISTIC MECHANISM
// Stateless functions that implement the policy without "magic numbers".
// ============================================================================

export const LogicCore = {
  /**
   * Calculates weighted score based on policy weights.
   */
  calculateScore: (criteria: EvaluationCriteria): number => {
    const { DIMENSIONS } = INTERVIEW_POLICY.SCORING;
    let score = 
      (criteria.accuracy * DIMENSIONS.ACCURACY.weight) +
      (criteria.depth * DIMENSIONS.DEPTH.weight) +
      (criteria.clarity * DIMENSIONS.CLARITY.weight) +
      (criteria.relevance * DIMENSIONS.RELEVANCE.weight);
    return Number(score.toFixed(2));
  },

  /**
   * Calculates time penalty and violation flag.
   */
  calculateTimeLogic: (seconds: number): { penalty: number, isViolation: boolean } => {
    const { PENALTY_START_SEC, PENALTY_STEP_SEC, PENALTY_PER_STEP } = INTERVIEW_POLICY.TIMING;
    
    if (seconds <= PENALTY_START_SEC) {
      return { penalty: 0, isViolation: false };
    }

    const overtime = seconds - PENALTY_START_SEC;
    const steps = Math.ceil(overtime / PENALTY_STEP_SEC);
    const penalty = steps * PENALTY_PER_STEP;
    return { penalty: Number(penalty.toFixed(1)), isViolation: true };
  },

  /**
   * Determines if a Resume Gap Penalty applies.
   */
  checkSkillGap: (targetSkill: string, gaps: InterviewState['detectedSkillGaps']): { penalty: number, type: string | null } => {
    const gap = gaps.find(g => g.skill.toLowerCase() === targetSkill.toLowerCase());
    
    if (!gap) return { penalty: 0, type: null };

    if (gap.type === 'PRIMARY') {
      return { penalty: INTERVIEW_POLICY.RESUME_JD_LOGIC.PENALTIES.PRIMARY_MISSING, type: 'PRIMARY' };
    } else {
      return { penalty: INTERVIEW_POLICY.RESUME_JD_LOGIC.PENALTIES.SECONDARY_MISSING, type: 'SECONDARY' };
    }
  },

  /**
   * Determines Difficulty Transition.
   */
  nextDifficulty: (current: Difficulty, score: number, ceiling: Difficulty | null): Difficulty => {
    const { STRONG_SCORE, WEAK_SCORE } = INTERVIEW_POLICY.SCORING;
    
    let next = current;

    // Escalate
    if (score >= STRONG_SCORE) {
      if (current === Difficulty.Easy) next = Difficulty.Medium;
      else if (current === Difficulty.Medium) next = Difficulty.Hard;
    } 
    // Downgrade
    else if (score <= WEAK_SCORE) {
      if (current === Difficulty.Hard) next = Difficulty.Medium;
      else if (current === Difficulty.Medium) next = Difficulty.Easy;
    }

    // Apply Ceiling Policy (Resume Constraint)
    if (ceiling) {
       // Hierarchy: Hard > Medium > Easy
       const levels = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];
       const nextIdx = levels.indexOf(next);
       const capIdx = levels.indexOf(ceiling);
       if (nextIdx > capIdx) {
         return ceiling; // Capped
       }
    }

    return next;
  }
};

// ============================================================================
// STATEFUL ENGINE
// Manages the session state and applies the LogicCore.
// ============================================================================

export class InterviewEngine {
  private state: InterviewState;
  private subscribers: ((state: InterviewState) => void)[] = [];

  constructor() {
    this.state = this.getInitialState();
  }

  private getInitialState(): InterviewState {
    return {
      status: 'IDLE',
      currentDifficulty: Difficulty.Easy,
      evaluationMode: 'LLM', // Default to LLM
      activeQuestion: null,
      turns: [],
      scoreHistory: [],
      consecutiveWeakAnswers: 0,
      timeViolations: 0,
      detectedSkillGaps: [],
      difficultyCeiling: null,
      terminationReason: null,
      logs: ['[SYSTEM] Engine Online. Policy: Strict. Mode: Deterministic.'],
      config: {
        maxQuestions: INTERVIEW_POLICY.TERMINATION.MAX_QUESTIONS,
        timeLimitPerQuestion: INTERVIEW_POLICY.TIMING.LIMIT_SEC,
        passingScoreThreshold: INTERVIEW_POLICY.SCORING.PASSING_THRESHOLD,
        maxViolations: INTERVIEW_POLICY.TIMING.MAX_VIOLATIONS_ALLOWED,
      },
    };
  }

  // --- State Access ---
  public getState() { return this.state; }
  
  public subscribe(cb: (s: InterviewState) => void) {
    this.subscribers.push(cb);
    return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
  }

  private notify() { this.subscribers.forEach(cb => cb(this.state)); }

  private log(msg: string) {
    const time = new Date().toLocaleTimeString();
    this.state.logs = [`[${time}] ${msg}`, ...this.state.logs];
    if (this.state.logs.length > 200) this.state.logs.pop();
  }

  public startAnalysis() {
    this.state.status = 'ANALYZING';
    this.log('[STATE] Analyzing Documents against Policy...');
    this.notify();
  }

  // --- Initialization Logic ---
  public initializeSession(jd: JobDescriptionData, resume: ResumeData) {
    // 1. JD Complexity -> Initial Difficulty
    const startDiff = INTERVIEW_POLICY.DIFFICULTY.INITIAL[jd.complexityLevel] || Difficulty.Easy;
    this.state.currentDifficulty = startDiff;
    this.log(`[POLICY] JD Complexity '${jd.complexityLevel}' sets Initial Difficulty to ${startDiff}.`);

    // 2. Skill Gap Analysis (Primary vs Secondary)
    const resumeSkills = new Set(resume.skills.map(s => s.name.toLowerCase().trim()));
    const gaps = [];

    // Check Primary
    let primaryMissing = 0;
    jd.primarySkills.forEach(skill => {
      if (!resumeSkills.has(skill.toLowerCase().trim())) {
        gaps.push({ skill, type: 'PRIMARY' as const });
        primaryMissing++;
      }
    });

    // Check Secondary
    jd.secondarySkills.forEach(skill => {
      if (!resumeSkills.has(skill.toLowerCase().trim())) {
        gaps.push({ skill, type: 'SECONDARY' as const });
      }
    });

    this.state.detectedSkillGaps = gaps;
    this.log(`[ANALYSIS] Found ${gaps.length} skill gaps (${primaryMissing} Primary).`);

    // 3. Difficulty Ceiling Logic (Constraint)
    const primaryCount = jd.primarySkills.length;
    const primaryMatchRate = primaryCount > 0 ? (primaryCount - primaryMissing) / primaryCount : 1;
    
    if (primaryMatchRate < INTERVIEW_POLICY.DIFFICULTY.CEILING.CRITICAL_GAP_MATCH_THRESHOLD) {
      this.state.difficultyCeiling = INTERVIEW_POLICY.DIFFICULTY.CEILING.CAP_LEVEL;
      this.log(`[POLICY] Critical Skill Match (${(primaryMatchRate*100).toFixed(0)}%) < 60%. Difficulty Capped at ${this.state.difficultyCeiling}.`);
    }

    // Transition to IDLE (Ready) instead of implicitly starting
    this.state.status = 'IDLE';
    this.log('[STATE] Initialization Complete. Waiting for Interview Start.');
    this.notify();
  }

  // --- Explicit Interview Lifecycle ---

  public setGenerating() {
    this.state.status = 'GENERATING';
    this.notify();
  }

  public startInterview(firstQuestion: Question) {
    if (this.state.status !== 'IDLE' && this.state.status !== 'GENERATING') {
      console.warn("Attempted to start interview from invalid state: " + this.state.status);
      return;
    }
    
    // Explicitly transition to active question via presentQuestion
    // This ensures activeQuestion is set BEFORE status is 'INTERVIEWING'
    this.log('[STATE] Session Initialized. Transitioning to INTERVIEWING.');
    this.presentQuestion(firstQuestion);
  }

  public presentQuestion(q: Question) {
    // CRITICAL: Order matters for UI determinism
    // 1. Set data
    this.state.activeQuestion = q;
    // 2. Set state
    this.state.status = 'INTERVIEWING';
    
    this.log(`[QUESTION] Q${this.state.turns.length + 1} Presented: ${q.targetSkill} (${q.difficulty}).`);
    this.notify();
  }

  // --- Explicit Submission API ---
  public async submitAnswer({ answerText, timeTakenSeconds }: { answerText: string, timeTakenSeconds: number }) {
    const question = this.state.activeQuestion;
    
    if (!question) {
      throw new Error("Cannot submit answer: No active question.");
    }

    if (this.state.status !== 'INTERVIEWING') {
      console.warn("Attempted submission while not INTERVIEWING.");
      return;
    }

    // 1. FREEZE STATE
    this.state.status = 'EVALUATING';
    this.log(`[EVENT] Answer submitted. Time: ${timeTakenSeconds.toFixed(1)}s.`);
    this.notify(); // Update UI to show loading/locked state

    // 2. PRE-EVALUATION (DETERMINISTIC FILTERS)
    // We determine criteria LOCALLY first to handle edge cases without wasting API tokens.
    let rawEvaluation: AnswerEvaluation | (EvaluationCriteria & { feedback: string; isFallback?: boolean });
    let isSpamOrEmpty = false;

    if (!answerText || answerText.trim().length === 0) {
      isSpamOrEmpty = true;
      const zero = INTERVIEW_POLICY.EDGE_CASES.EMPTY_ANSWER_SCORE;
      this.log(`[EDGE CASE] Empty answer detected. Forcing score to ${zero}.`);
      rawEvaluation = { 
        accuracy: zero, depth: zero, clarity: zero, relevance: zero, 
        feedback: "Automatic Failure: No answer provided.",
        isFallback: true // Technically a local fallback
      };
    } 
    else if (timeTakenSeconds * 1000 < INTERVIEW_POLICY.TIMING.MIN_ANSWER_TIME_MS && answerText.length > 5) {
      isSpamOrEmpty = true;
      const zero = INTERVIEW_POLICY.EDGE_CASES.SPAM_ANSWER_SCORE;
      this.log(`[EDGE CASE] Response time (${timeTakenSeconds}s) below biological threshold. Flagged as Spam.`);
      rawEvaluation = {
         accuracy: zero, depth: zero, clarity: zero, relevance: zero,
         feedback: "Automatic Failure: Response time impossibly fast (Spam detection).",
         isFallback: true
      };
    }

    // 3. API EVALUATION (Only if valid)
    if (!isSpamOrEmpty) {
      // evaluateAnswer is now WRAPPED with safe error handling and internal fallback logic
      const result = await evaluateAnswer(question, answerText);
      rawEvaluation = result;
      
      // Update System Mode if Fallback was triggered
      if (result.isFallback && this.state.evaluationMode !== 'FALLBACK_RULE_BASED') {
        this.state.evaluationMode = 'FALLBACK_RULE_BASED';
        this.log('[WARN] External AI Unavailable. Switched to Deterministic Fallback Mode.');
      }
    }

    // 4. SCORING & POLICY EXECUTION
    
    // C. Calculate Base Score
    const baseScore = LogicCore.calculateScore(rawEvaluation!);

    // D. Calculate Time Logic
    const { penalty: timePenalty, isViolation } = LogicCore.calculateTimeLogic(timeTakenSeconds);
    if (isViolation) {
      this.state.timeViolations++;
      this.log(`[POLICY] Time Violation #${this.state.timeViolations} recorded (-${timePenalty} pts).`);
    }

    // E. Calculate Skill Gap Penalty
    const { penalty: gapPenalty, type: gapType } = LogicCore.checkSkillGap(question.targetSkill, this.state.detectedSkillGaps);
    if (gapPenalty > 0) {
      this.log(`[POLICY] ${gapType} Skill Gap ('${question.targetSkill}') penalty applied: -${gapPenalty}`);
    }

    // F. Final Score
    const finalScore = Math.max(0, baseScore - timePenalty - gapPenalty);
    this.log(`[SCORE] Base: ${baseScore} | Time: -${timePenalty} | Gap: -${gapPenalty} | Final: ${finalScore.toFixed(2)}`);

    // G. Difficulty Adaptation
    const nextDiff = LogicCore.nextDifficulty(this.state.currentDifficulty, finalScore, this.state.difficultyCeiling);
    if (nextDiff !== this.state.currentDifficulty) {
      if (this.state.difficultyCeiling && nextDiff === this.state.difficultyCeiling && this.state.currentDifficulty === this.state.difficultyCeiling) {
        this.log(`[ADAPT] Adaptation blocked by Policy Ceiling (${this.state.difficultyCeiling}).`);
      } else {
        this.log(`[ADAPT] Difficulty transitioning: ${this.state.currentDifficulty} -> ${nextDiff}`);
      }
    }

    // H. Strike System
    const { CRITICAL_FAIL_SCORE, WEAK_SCORE } = INTERVIEW_POLICY.SCORING;
    let strikes = 0;
    
    if (finalScore <= CRITICAL_FAIL_SCORE) {
      strikes = INTERVIEW_POLICY.TERMINATION.CRITICAL_FAIL_STRIKES;
      this.log(`[RISK] Critical Failure (<= ${CRITICAL_FAIL_SCORE}). +${strikes} Strikes.`);
    } else if (finalScore <= WEAK_SCORE) {
      strikes = 1;
      this.log(`[RISK] Weak Answer (<= ${WEAK_SCORE}). +1 Strike.`);
    } else {
      if (this.state.consecutiveWeakAnswers > 0) {
        this.log(`[RECOVERY] Performance stabilized. Resetting consecutive strike counter.`);
        this.state.consecutiveWeakAnswers = 0;
      }
    }
    
    this.state.consecutiveWeakAnswers += strikes;

    // I. Record Turn
    const turn: InterviewTurn = {
      question,
      answer: answerText,
      evaluation: {
        ...rawEvaluation!,
        totalScore: baseScore,
        timeTakenSeconds,
        timePenalty,
        finalScore,
        feedback: rawEvaluation!.feedback || "Processed by Policy Engine",
        skillGapPenalty: gapPenalty,
        isFallback: rawEvaluation!.isFallback
      },
      difficultyBefore: this.state.currentDifficulty,
      difficultyAfter: nextDiff,
      timestamp: Date.now(),
      criticalFailure: finalScore <= CRITICAL_FAIL_SCORE
    };

    this.state.turns.push(turn);
    this.state.scoreHistory.push(finalScore);
    this.state.currentDifficulty = nextDiff;
    this.state.activeQuestion = null; // Clear active question

    // J. Check Termination / Transition
    if (!this.checkTermination()) {
      // If not terminated, we are effectively GENERATING waiting for the next question.
      this.state.status = 'GENERATING'; 
      this.notify();
    }
  }

  private calculateFinalAverage(): string {
    if (this.state.scoreHistory.length === 0) return "0.00";
    const sum = this.state.scoreHistory.reduce((a, b) => a + b, 0);
    return (sum / this.state.scoreHistory.length).toFixed(2);
  }

  private checkTermination(): boolean {
    const { STRIKE_LIMIT, MAX_QUESTIONS } = INTERVIEW_POLICY.TERMINATION;
    const { MAX_VIOLATIONS_ALLOWED } = INTERVIEW_POLICY.TIMING;

    // 1. Time Violation Termination (PRIORITY ENFORCEMENT)
    if (this.state.timeViolations > MAX_VIOLATIONS_ALLOWED) {
      this.terminate(`Time Management Failure: ${this.state.timeViolations} violations exceeded limit of ${MAX_VIOLATIONS_ALLOWED}.`);
      return true;
    }

    // 2. Strike Termination
    if (this.state.consecutiveWeakAnswers >= STRIKE_LIMIT) {
      this.terminate(`Performance Threshold Reached: ${this.state.consecutiveWeakAnswers} consecutive strikes.`);
      return true;
    }

    // 3. Question Limit
    if (this.state.turns.length >= MAX_QUESTIONS) {
      this.state.status = 'COMPLETED';
      this.log(`[FINAL] Interview score finalized: ${this.calculateFinalAverage()}`);
      this.log('[TERM] Interview Completed: Maximum question depth reached.');
      this.notify();
      return true;
    }

    return false;
  }

  private terminate(reason: string) {
    this.state.status = 'TERMINATED';
    this.state.terminationReason = reason;
    this.log(`[FINAL] Interview score finalized: ${this.calculateFinalAverage()}`);
    this.log(`[TERM] TERMINATION TRIGGERED: ${reason}`);
    this.notify();
  }

  public reset() {
    this.state = this.getInitialState();
    this.notify();
  }
}

export const engine = new InterviewEngine();
