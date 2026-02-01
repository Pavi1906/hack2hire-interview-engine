
# Hack2Hire Engine: AI-Powered & Deterministic

A strict, rule-driven interview simulation engine powered by Gemini for content generation and evaluation. It visualizes the state machine, scoring logic, and decision rules in real-time.

## 🏆 Judge's Guide: Verification Scenarios

To verify the system's robustness and policy enforcement, try these scenarios:

### 1. The "Resilience" Test (AI Failure / Fallback)
*   **Action**: Disconnect your internet OR provide an invalid API key, then attempt to start an interview.
*   **Expectation**: The system will **NOT** crash. It will log a warning, switch the UI to "Fallback Mode" (Yellow Badge), and continue the interview using the deterministic logic engine and internal question pool.

### 2. The "Spam Detection" Test
*   **Action**: Answer a question in under 2 seconds with gibberish (e.g., "asdf").
*   **Expectation**: The Policy Engine will immediately flag this as "Spam", award 0 points, and log a specific `[EDGE CASE]` warning.

### 3. The "Early Termination" Test
*   **Action**: Intentionally provide very short, weak answers ("I don't know") for 3 consecutive questions.
*   **Expectation**: The interview will terminate early after the 3rd strike with a "Policy Triggered" status, proving the system enforces quality standards.

---

## Deterministic Engine Design

This system is built on a **Policy-Driven Architecture**. It does not rely on vague "AI judgment" for critical state transitions.

1.  **State Machine**: The interview flow is a finite state machine (IDLE -> ANALYZING -> INTERVIEWING -> EVALUATING). Transitions are hard-coded and guarded.
2.  **No Randomness**: Scoring arithmetic, difficulty progression, and penalties are calculated using fixed constants defined in `services/policy.ts`.
3.  **Auditability**: Every decision is logged with a timestamp and reason. The final score is a mathematical derivative of the inputs, not an LLM hallucination.

## AI Dependency & Fallback Strategy

To ensure high availability and resilience during demos, this system treats Gemini AI as an **optional** dependency.

### Reliability Engineering
-   **Graceful Degradation**: If the Gemini API returns a Quota Exceeded (429) or Service Unavailable (503) error, the system **automatically** switches to a deterministic fallback mode.
-   **Zero Downtime**: The interview flow is never interrupted. The user is not prompted to retry or check logs.
-   **Explicit Mode Switching**: The system logs `[WARN] External AI Unavailable. Switched to Deterministic Fallback Mode.` and updates the UI with a "Fallback Mode Active" badge.

### Deterministic Fallback Evaluator
When AI is unavailable, the `FallbackRegistry` takes over:
1.  **Question Generation**: Selects from a static, curated pool of high-quality questions mapped to skills.
2.  **Evaluation**: Uses a keyword-density and length-heuristic algorithm to score answers.
    -   **Score**: `Base + (Keywords_Found * 2) + Length_Bonus`.
    -   **Feedback**: "Score calculated based on length and keyword coverage."

This ensures that the interview logic—state transitions, difficulty adaptation, and termination rules—remains **100% functional** even without an internet connection or valid API key.

## Early Termination Logic

The engine implements realistic "Fail Fast" logic found in actual technical interviews.

*   **Strike System**: If a candidate provides **3 consecutive weak answers** (Score < 4.5), the interview is terminated. This mirrors a real interviewer deciding a candidate is not a fit to save time.
*   **Time Management**: Excessive time violations (>2) trigger termination, reflecting the critical need for communication efficiency in senior roles.
*   **Critical Failure**: A score of < 2.0 (Spam/Empty) counts as **2 strikes** immediately.

**Why this matters**: It proves the engine isn't just a chatbot; it's an evaluation system with standards.
