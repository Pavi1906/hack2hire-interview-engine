# Hack2Hire Engine: AI-Powered & Deterministic

A **strict, rule-driven interview simulation engine** designed to model real technical interviews using deterministic policies, explicit state machines, and explainable scoring.

The system uses Gemini for enhanced evaluation **when available**, but is fully functional in deterministic fallback mode to guarantee reliability.

---

## 🎥 Demo Video (Mandatory for Evaluation)

👉 **Full Working Demo (Screen Recording):**  
<VIDEO_LINK>

The video demonstrates:
- Resume & JD analysis
- Interview start
- Question → Answer → Submit flow
- Scoring & adaptive difficulty
- Early termination
- Gemini failure → deterministic fallback mode
- Full engine logs

---

## 🏆 Judge’s Guide: Verification Scenarios

Use the following scenarios to verify robustness and policy enforcement.

### 1️⃣ The “Resilience” Test (AI Failure / Fallback)

**Action:**  
Disconnect internet **or** provide an invalid Gemini API key, then start an interview.

**Expected Behavior:**  
- System does **not** crash  
- Logs a warning  
- UI switches to **Fallback Mode** (yellow badge)  
- Interview continues using deterministic logic and internal question pool  

---

### 2️⃣ The “Spam Detection” Test

**Action:**  
Answer a question in under 2 seconds with gibberish (e.g., `asdf`).

**Expected Behavior:**  
- Policy Engine flags the response as **Spam**  
- Score = `0`  
- `[EDGE CASE]` warning logged  

---

### 3️⃣ The “Early Termination” Test

**Action:**  
Provide weak answers (e.g., “I don’t know”) for 3 consecutive questions.

**Expected Behavior:**  
- Interview terminates early  
- Status shows **Policy Triggered**  
- Demonstrates strict quality enforcement  

---

## 🧠 Deterministic Engine Design

This system is built using a **Policy-Driven Architecture**.

- **State Machine:**  
  `IDLE → ANALYZING → READY → INTERVIEWING → EVALUATING → TERMINATED`

- **No Randomness:**  
  Scoring, difficulty progression, penalties, and termination rules are calculated using fixed constants defined in `services/policy.ts`.

- **Auditability:**  
  Every decision is logged with a timestamp and reason.  
  Final scores are mathematical derivatives of inputs — not LLM hallucinations.

---

## 🤖 AI Dependency & Fallback Strategy

Gemini is treated as an **optional enhancement**, not a requirement.

### Reliability Engineering Principles

- **Graceful Degradation:**  
  On Gemini errors (Quota Exceeded `429`, Service Unavailable `503`), the system switches automatically to deterministic fallback evaluation.

- **Zero Downtime:**  
  The interview flow is never interrupted. Users are not prompted to retry or debug.

- **Explicit Mode Switching:**  
  Logs:  
  `[WARN] External AI Unavailable → Switched to Deterministic Fallback Mode`  
  UI shows **Fallback Mode Active** badge.

---

## 🔁 Deterministic Fallback Evaluator

When AI is unavailable, the `FallbackRegistry` takes over:

- **Question Generation:**  
  Static, curated question pool mapped to skills.

- **Evaluation Logic:**  
  Keyword density + answer length heuristic.

- **Scoring Formula:**  
  `Score = Base + (Keywords_Found × 2) + Length_Bonus`

- **Feedback:**  
  “Score calculated based on length and keyword coverage.”

This guarantees that **state transitions, difficulty adaptation, and termination logic remain fully functional offline**.

---

## ⛔ Early Termination Logic (Fail-Fast Design)

The engine models real interview screening behavior:

- **Strike System:**  
  3 consecutive weak answers (`Score < 4.5`) → termination

- **Time Violations:**  
  More than 2 excessive delays → termination

- **Critical Failure:**  
  `Score < 2.0` (spam/empty) counts as **2 strikes**

**Why this matters:**  
This proves the engine is not a chatbot — it is an **evaluation system with standards**.

