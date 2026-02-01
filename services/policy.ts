
import { Difficulty } from "../types";

// ============================================================================
// THE AUDITABLE POLICY CONFIGURATION
// This object defines ALL rules. The engine simply executes these rules.
// Judges can review this file to understand the system's "Constitution".
// ============================================================================

export const INTERVIEW_POLICY = {
  SCORING: {
    DIMENSIONS: {
      ACCURACY: { weight: 0.40, label: 'Accuracy' },
      DEPTH: { weight: 0.30, label: 'Depth' },
      CLARITY: { weight: 0.15, label: 'Clarity' },
      RELEVANCE: { weight: 0.15, label: 'Relevance' },
    },
    // Thresholds
    STRONG_SCORE: 8.0,
    WEAK_SCORE: 4.5,
    CRITICAL_FAIL_SCORE: 2.0,
    PASSING_THRESHOLD: 6.0,
  },

  FALLBACK_SCORING: {
    // Heuristic Weights for Rule-Based Evaluation
    KEYWORD_MATCH_VALUE: 2.0, // Points per keyword found
    LENGTH_THRESHOLD_CHARS: 50,
    LENGTH_BONUS: 1.0,        // Points for meeting length threshold
    BASE_SCORE: 4.0,          // Neutral starting score
    MAX_SCORE: 8.5,           // Fallback never gives perfect 10 to ensure skepticism
  },
  
  TIMING: {
    LIMIT_SEC: 60,
    PENALTY_START_SEC: 60,
    PENALTY_STEP_SEC: 5,
    PENALTY_PER_STEP: 0.5,
    MAX_VIOLATIONS_ALLOWED: 2, // 3rd violation = Termination
    MIN_ANSWER_TIME_MS: 2000,  // Answers faster than 2s are considered spam/cheating
  },
  
  DIFFICULTY: {
    // Initial mapping based on JD Complexity
    INITIAL: {
      'Senior': Difficulty.Medium,
      'Mid': Difficulty.Easy,
      'Junior': Difficulty.Easy,
    },
    // Difficulty Ceiling Logic
    CEILING: {
      CRITICAL_GAP_MATCH_THRESHOLD: 0.6, // If < 60% critical skills match, cap difficulty
      CAP_LEVEL: Difficulty.Medium,
    }
  },

  RESUME_JD_LOGIC: {
    // Penalties for answering a question about a missing skill
    PENALTIES: {
      PRIMARY_MISSING: 1.5,   // Heavy penalty for missing critical skill
      SECONDARY_MISSING: 0.5, // Light penalty for missing nice-to-have
    }
  },

  TERMINATION: {
    MAX_QUESTIONS: 5,
    STRIKE_LIMIT: 3,         // Consecutive weak answers
    CRITICAL_FAIL_STRIKES: 2 // How many strikes a critical fail (<2.0) is worth
  },

  EDGE_CASES: {
    EMPTY_ANSWER_SCORE: 0,
    IRRELEVANT_ANSWER_SCORE: 0,
    SPAM_ANSWER_SCORE: 0, // Score for impossible completion times
  }
};
