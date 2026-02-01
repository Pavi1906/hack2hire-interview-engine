
import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ResumeData, JobDescriptionData, Question, Difficulty, AnswerEvaluation } from "../types";
import { INTERVIEW_POLICY } from "./policy";

const getClient = () => {
  const apiKey = import.meta.env.VITE_API_KEY;
  if (!apiKey) throw new Error("VITE_API_KEY not found in environment");
  return new GoogleGenAI({ apiKey });
};

// --- Fallback Registry ---
// Deterministic data and logic for when LLM is unavailable

const FallbackRegistry = {
  QUESTIONS: [
    { text: "Explain the virtual DOM in React and its performance benefits.", targetSkill: "React", keywords: ["diffing", "reconciliation", "memory", "batching"] },
    { text: "What are the differences between LocalStorage, SessionStorage, and Cookies?", targetSkill: "Web Storage", keywords: ["expiration", "server", "capacity", "persistent"] },
    { text: "Explain how closures work in JavaScript and provide a use case.", targetSkill: "JavaScript", keywords: ["scope", "function", "lexical", "memory"] },
    { text: "Describe the CSS Box Model.", targetSkill: "CSS", keywords: ["margin", "border", "padding", "content"] },
    { text: "How do you handle asynchronous operations in Node.js?", targetSkill: "Node.js", keywords: ["promise", "async", "await", "callback"] }
  ],

  evaluate: (question: Question, answer: string): Omit<AnswerEvaluation, 'totalScore' | 'timeTakenSeconds' | 'timePenalty' | 'finalScore'> & { isFallback: boolean } => {
    const { FALLBACK_SCORING } = INTERVIEW_POLICY;
    const lowerAnswer = answer.toLowerCase();
    
    // 1. Keyword Analysis
    let keywordHits = 0;
    const missingKeywords: string[] = [];
    question.expectedKeywords.forEach(kw => {
      if (lowerAnswer.includes(kw.toLowerCase())) keywordHits++;
      else missingKeywords.push(kw);
    });

    // 2. Length Analysis
    const isShort = answer.length < FALLBACK_SCORING.LENGTH_THRESHOLD_CHARS;
    
    // 3. Scoring Heuristic
    let heuristicScore = FALLBACK_SCORING.BASE_SCORE;
    heuristicScore += (keywordHits * FALLBACK_SCORING.KEYWORD_MATCH_VALUE);
    if (!isShort) heuristicScore += FALLBACK_SCORING.LENGTH_BONUS;

    // Cap Score
    heuristicScore = Math.min(heuristicScore, FALLBACK_SCORING.MAX_SCORE);

    // 4. Construct Feedback
    let feedback = `[Deterministic Evaluation] Score calculated based on length and keyword coverage. `;
    if (keywordHits > 0) feedback += `Identified ${keywordHits} relevant concepts. `;
    else feedback += `Answer lacked specific expected technical terminology. `;
    
    if (isShort) feedback += "Response was brief.";

    return {
      accuracy: Math.min(10, heuristicScore),
      clarity: 6, // Neutral assumption
      depth: isShort ? 3 : 6,
      relevance: keywordHits > 0 ? 8 : 4,
      feedback: feedback,
      isFallback: true
    };
  },

  mockResume: (text: string): ResumeData => ({
    candidateName: "Candidate (Fallback Parsing)",
    experienceYears: 3,
    primaryRole: "Developer",
    skills: [
      { name: "React", level: "Mid" },
      { name: "TypeScript", level: "Mid" },
      { name: "JavaScript", level: "Senior" }
    ]
  }),

  mockJD: (text: string): JobDescriptionData => ({
    roleTitle: "Software Engineer (Fallback Parsing)",
    complexityLevel: "Mid",
    primarySkills: ["React", "TypeScript", "Node.js"],
    secondarySkills: ["AWS", "Testing"],
    description: text
  })
};

// --- Schemas ---

const resumeSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    candidateName: { type: Type.STRING },
    experienceYears: { type: Type.NUMBER },
    primaryRole: { type: Type.STRING },
    skills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          level: { type: Type.STRING, enum: ["Junior", "Mid", "Senior"] },
        },
        required: ["name", "level"]
      },
    },
  },
  required: ["candidateName", "experienceYears", "primaryRole", "skills"],
};

const jdSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    roleTitle: { type: Type.STRING },
    complexityLevel: { type: Type.STRING, enum: ["Junior", "Mid", "Senior"] },
    primarySkills: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Critical, non-negotiable core skills for the role."
    },
    secondarySkills: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Nice-to-have, bonus, or peripheral skills."
    },
  },
  required: ["roleTitle", "complexityLevel", "primarySkills", "secondarySkills"],
};

const questionSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    targetSkill: { type: Type.STRING },
    expectedKeywords: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["text", "targetSkill", "expectedKeywords"],
};

const evaluationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    accuracy: { type: Type.NUMBER, description: "0-10. Factual correctness." },
    clarity: { type: Type.NUMBER, description: "0-10. Communication quality." },
    depth: { type: Type.NUMBER, description: "0-10. Technical depth vs difficulty." },
    relevance: { type: Type.NUMBER, description: "0-10. Directness of answer." },
    feedback: { type: Type.STRING },
  },
  required: ["accuracy", "clarity", "depth", "relevance", "feedback"],
};

// --- API Calls with Graceful Degradation ---

export const parseResume = async (text: string): Promise<ResumeData> => {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this resume text and extract structured data:\n\n${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: resumeSchema,
      },
    });
    
    if (!response.text) throw new Error("Empty response");
    return JSON.parse(response.text) as ResumeData;
  } catch (error) {
    console.warn("Gemini Resume Parse Failed:", error);
    return FallbackRegistry.mockResume(text);
  }
};

export const parseJD = async (text: string): Promise<JobDescriptionData> => {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this job description and extract structured data. Separate skills into Primary (Critical) and Secondary (Nice-to-have):\n\n${text}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: jdSchema,
      },
    });

    if (!response.text) throw new Error("Empty response");
    const data = JSON.parse(response.text);
    return { ...data, description: text } as JobDescriptionData;
  } catch (error) {
    console.warn("Gemini JD Parse Failed:", error);
    return FallbackRegistry.mockJD(text);
  }
};

export const generateQuestion = async (
  jd: JobDescriptionData,
  resume: ResumeData,
  currentDifficulty: Difficulty,
  previousQuestions: string[]
): Promise<Question> => {
  try {
    const ai = getClient();
    const allSkills = [...jd.primarySkills, ...jd.secondarySkills];
    
    const prompt = `
      Context: Technical Interview.
      Role: ${jd.roleTitle} (${jd.complexityLevel}).
      Candidate: ${resume.experienceYears} YOE.
      Current Difficulty: ${currentDifficulty}.
      
      Primary Skills (Critical): ${jd.primarySkills.join(", ")}.
      Secondary Skills: ${jd.secondarySkills.join(", ")}.
      Candidate Skills: ${resume.skills.map(s => s.name).join(", ")}.

      Previous Questions Topics: ${previousQuestions.join(", ")}.

      Task: Generate a single UNIQUE technical interview question.
      - Focus on Primary Skills unless covered.
      - If Difficulty is Easy: Focus on basic definitions.
      - If Difficulty is Medium: Focus on application/trade-offs.
      - If Difficulty is Hard: Focus on internals/system design.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: questionSchema,
        temperature: 0.7,
      },
    });

    if (!response.text) throw new Error("Empty response");
    const data = JSON.parse(response.text);
    return { ...data, id: crypto.randomUUID(), difficulty: currentDifficulty } as Question;
  } catch (error) {
    console.warn("Gemini Question Gen Failed:", error);
    // Fallback Selection Strategy: Randomly pick a question we haven't asked yet if possible
    const pool = FallbackRegistry.QUESTIONS;
    const fallbackQ = pool[Math.floor(Math.random() * pool.length)];
    return {
      id: crypto.randomUUID(),
      text: fallbackQ.text,
      targetSkill: fallbackQ.targetSkill,
      expectedKeywords: fallbackQ.keywords,
      difficulty: currentDifficulty // Map existing pool to current diff requested
    };
  }
};

export const evaluateAnswer = async (
  question: Question,
  answer: string
): Promise<Omit<AnswerEvaluation, 'totalScore' | 'timeTakenSeconds' | 'timePenalty' | 'finalScore'>> => {
  
  // Try AI first
  try {
    const ai = getClient();
    const { DIMENSIONS } = INTERVIEW_POLICY.SCORING;

    const prompt = `
      You are a strict technical interviewer.
      Question: "${question.text}"
      Target Skill: ${question.targetSkill}
      Difficulty: ${question.difficulty}
      Expected Keywords: ${question.expectedKeywords.join(", ")}

      Candidate Answer: "${answer}"

      Evaluate strictly (0-10):
      1. ${DIMENSIONS.ACCURACY.label} (${DIMENSIONS.ACCURACY.weight}): Factually correct?
      2. ${DIMENSIONS.DEPTH.label} (${DIMENSIONS.DEPTH.weight}): Seniority appropriate?
      3. ${DIMENSIONS.CLARITY.label} (${DIMENSIONS.CLARITY.weight}): Structured?
      4. ${DIMENSIONS.RELEVANCE.label} (${DIMENSIONS.RELEVANCE.weight}): Answered prompt?

      If answer is nonsense, empty, or completely wrong, give 0.
      Provide constructive feedback.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: evaluationSchema,
      },
    });

    if (!response.text) throw new Error("Empty response");
    const result = JSON.parse(response.text);
    return { ...result, isFallback: false };

  } catch (error) {
    console.warn("Gemini Evaluation Failed:", error);
    // Switch to Deterministic Fallback
    return FallbackRegistry.evaluate(question, answer);
  }
};
