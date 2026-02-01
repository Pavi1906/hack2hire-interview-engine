
import React, { useState, useEffect, useRef } from 'react';
import { BrainCircuit, Clock, ChevronRight, Play, RotateCcw, AlertTriangle, CheckCircle, User, BookOpen, ShieldCheck, ZapOff } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { engine } from './services/engine';
import * as GeminiService from './services/gemini';
import { InterviewState, ResumeData, JobDescriptionData, Question, Difficulty } from './types';
import { LogViewer } from './components/LogViewer';
import { DifficultyBadge, ScoreBadge } from './components/StatusBadge';
import { INTERVIEW_POLICY } from './services/policy';

// --- Default Data ---
const DEFAULT_RESUME = `Name: Alex Chen
Experience: 3 years
Role: Frontend Developer
Skills: React (Mid), TypeScript (Mid), Node.js (Junior), CSS (Senior), Web Performance (Junior)
`;

const DEFAULT_JD = `Role: Senior Frontend Engineer
Complexity: Senior
Primary Skills: React, TypeScript, System Design, GraphQL
Secondary Skills: Performance Optimization, AWS, CI/CD
Description: We are looking for a senior engineer. Critical: React/TS/GraphQL. Nice to have: AWS.`;

const App: React.FC = () => {
  const [engineState, setEngineState] = useState<InterviewState>(engine.getState());
  
  // Data Inputs
  const [resumeText, setResumeText] = useState(DEFAULT_RESUME);
  const [jdText, setJdText] = useState(DEFAULT_JD);
  
  // Parsed Data
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [jdData, setJdData] = useState<JobDescriptionData | null>(null);
  
  // Interaction Local State
  const [userAnswer, setUserAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  // Timer & Processing
  const [timeLeft, setTimeLeft] = useState(0);
  // Use 'any' for timer ref to handle environment differences (Node.js vs Browser definitions)
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  
  const activeQuestion = engineState.activeQuestion;
  const isFallbackMode = engineState.evaluationMode === 'FALLBACK_RULE_BASED';

  // Subscribe to Engine Updates
  useEffect(() => {
    // CRITICAL FIX: We must spread the state into a new object to ensure React detects the change.
    // The engine mutates state in place, so simple passing would fail strict equality checks in React 18.
    const handleStateUpdate = (s: InterviewState) => setEngineState({ ...s });
    return engine.subscribe(handleStateUpdate);
  }, []);

  // Timer Logic & Auto-Submit
  useEffect(() => {
    if (engineState.status === 'INTERVIEWING' && activeQuestion) {
      // Start or sync timer
      if (startTimeRef.current === 0) {
        startTimeRef.current = Date.now();
        setTimeLeft(engineState.config.timeLimitPerQuestion);
      }
      
      // Clear existing timer if any to prevent duplicates
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // TIMEOUT AUTO-SUBMIT
            if (timerRef.current) clearInterval(timerRef.current);
            handleAutoSubmit(); 
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      startTimeRef.current = 0; // Reset for next turn
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [engineState.status, activeQuestion?.id]); // Depend on question ID to reset timer strictly on new questions


  // --- Actions ---

  const handleStartAnalysis = async () => {
    // GUARD: Prevent double-invocation of analysis
    if (engine.getState().status === 'ANALYZING') return;

    setError(null);
    engine.startAnalysis();
    try {
      const [rData, jData] = await Promise.all([
        GeminiService.parseResume(resumeText),
        GeminiService.parseJD(jdText)
      ]);
      setResumeData(rData);
      setJdData(jData);
      
      engine.initializeSession(jData, rData);
      // We stop here (State: IDLE). User must manually "Start Interview".
    } catch (e: any) {
      // Fallback is handled inside GeminiService, but if something catastrophic happens:
      setError(e.message || "Failed to analyze documents");
      engine.reset();
    }
  };

  const handleBeginSession = async () => {
    // GUARD: Strict State Check
    const currentStatus = engine.getState().status;
    if (currentStatus !== 'IDLE') {
      return; 
    }

    if (!jdData || !resumeData) return;
    
    // Explicitly Enter Generating State immediately to block further clicks
    engine.setGenerating();
    
    try {
      // Fetch FIRST question before transitioning to INTERVIEWING
      const q = await GeminiService.generateQuestion(jdData, resumeData, engine.getState().currentDifficulty, []);
      
      // Secondary Check: Ensure state is still GENERATING before starting
      if (engine.getState().status === 'GENERATING') {
        engine.startInterview(q);
        setUserAnswer('');
      }
    } catch (e: any) {
      setError("Failed to start session: " + e.message);
      engine.reset();
    }
  };

  const fetchNextQuestion = async (jd: JobDescriptionData, resume: ResumeData, diff: Difficulty) => {
    try {
      const prevQuestions = engine.getState().turns.map(t => t.question.text);
      const q = await GeminiService.generateQuestion(jd, resume, diff, prevQuestions);
      // Explicitly Present Question via Engine
      engine.presentQuestion(q);
      setUserAnswer('');
    } catch (e: any) {
      setError("Failed to generate question: " + e.message);
    }
  };

  const handleManualSubmit = async () => {
    // GUARD: Prevent submission if not in INTERVIEWING state
    if (engine.getState().status !== 'INTERVIEWING') return;
    if (!activeQuestion || !jdData || !resumeData) return;
    
    // Explicit Submission Logic
    const timeLimit = engineState.config.timeLimitPerQuestion;
    const timeTaken = Math.max(0, timeLimit - timeLeft);
    
    await executeSubmission(userAnswer, timeTaken);
  };

  const handleAutoSubmit = async () => {
    if (!activeQuestion || !jdData || !resumeData) return;
    
    // Timeout Submission Logic
    const timeLimit = engineState.config.timeLimitPerQuestion;
    console.log("Timeout reached. Auto-submitting.");
    await executeSubmission(userAnswer, timeLimit); // Penalty logic will handle this
  };

  const executeSubmission = async (text: string, timeTaken: number) => {
    try {
      await engine.submitAnswer({ answerText: text, timeTakenSeconds: timeTaken });
      
      // Post-Submission Flow
      const newState = engine.getState();
      if (newState.status === 'GENERATING') {
        if (jdData && resumeData) {
          await fetchNextQuestion(jdData, resumeData, newState.currentDifficulty);
        }
      }
    } catch (e: any) {
      setError("Submission Error: " + e.message);
    }
  };

  const handleReset = () => {
    engine.reset();
    setResumeData(null);
    setJdData(null);
    setUserAnswer('');
    setError(null);
    startTimeRef.current = 0;
  };

  // --- Render Logic (Strict State Switch) ---
  
  const renderContent = () => {
    switch (engineState.status) {
      case 'IDLE':
        if (resumeData && jdData) {
          // --- READY SCREEN ---
          return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex-1 flex flex-col justify-center items-center gap-8 animate-fade-in">
              <div className="text-center space-y-2">
                 <div className="inline-flex items-center justify-center p-4 bg-green-500/10 rounded-full mb-4">
                    <CheckCircle className="text-green-500" size={48} />
                 </div>
                 <h2 className="text-2xl font-bold text-white">Analysis Complete</h2>
                 <p className="text-slate-400 max-w-md mx-auto">
                   The policy engine has analyzed the candidate profile against the job description. 
                   Ready to begin the deterministic interview sequence.
                 </p>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                 <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase font-bold mb-1">Target Role</div>
                    <div className="font-semibold text-slate-200">{jdData.roleTitle}</div>
                    <div className="text-xs text-slate-500">{jdData.complexityLevel} Complexity</div>
                 </div>
                 <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                    <div className="text-slate-500 text-xs uppercase font-bold mb-1">Initial Difficulty</div>
                    <DifficultyBadge difficulty={engineState.currentDifficulty} />
                 </div>
                 <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 col-span-2">
                    <div className="flex justify-between items-center mb-1">
                        <div className="text-slate-500 text-xs uppercase font-bold">Detected Gaps</div>
                        {engineState.detectedSkillGaps.length === 0 && <span className="text-green-500 text-xs">None Detected</span>}
                    </div>
                    {engineState.detectedSkillGaps.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {engineState.detectedSkillGaps.map(g => (
                          <span key={g.skill} className={`text-xs px-2 py-1 rounded border ${g.type === 'PRIMARY' ? 'bg-red-900/30 border-red-800 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                            {g.skill}
                          </span>
                        ))}
                      </div>
                    ) : (
                       <div className="text-sm text-slate-500">Candidate profile matches all required skills.</div>
                    )}
                 </div>
              </div>

              <button 
                onClick={handleBeginSession}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-all flex items-center gap-2 text-lg shadow-lg shadow-indigo-900/20"
              >
                <Play size={24} /> Begin Interview
              </button>
            </div>
          );
        }
        
        // --- SETUP SCREEN ---
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex-1 flex flex-col gap-6 animate-fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1">
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 font-semibold text-slate-300">
                    <User size={18} /> Candidate Resume (Text)
                  </label>
                  <textarea 
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-4 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none scrollbar-thin"
                    value={resumeText}
                    onChange={(e) => setResumeText(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 font-semibold text-slate-300">
                    <BookOpen size={18} /> Job Description (Text)
                  </label>
                  <textarea 
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-4 text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none resize-none scrollbar-thin"
                    value={jdText}
                    onChange={(e) => setJdText(e.target.value)}
                  />
                </div>
              </div>
              <button 
                onClick={handleStartAnalysis}
                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-all flex justify-center items-center gap-2 text-lg shadow-lg shadow-indigo-900/20"
              >
                <Play size={20} /> Initialize Policy Engine
              </button>
            </div>
        );

      case 'ANALYZING':
      case 'GENERATING':
      case 'EVALUATING':
        // --- LOADING STATES ---
        let msg = "Processing...";
        if (engineState.status === 'ANALYZING') msg = "Executing Policy Analysis...";
        if (engineState.status === 'GENERATING') msg = "Generating Question...";
        if (engineState.status === 'EVALUATING') msg = "Locking turn & Evaluating...";

        return (
             <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 flex items-center justify-center flex-1">
               <div className="flex flex-col items-center gap-4">
                 <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                 <p className="text-slate-400 font-mono">{msg}</p>
                 {engineState.evaluationMode === 'FALLBACK_RULE_BASED' && (
                    <span className="text-yellow-500 text-xs font-bold border border-yellow-800 px-2 py-1 rounded">
                      Fallback Mode Active
                    </span>
                 )}
               </div>
             </div>
        );

      case 'INTERVIEWING':
        // --- ACTIVE QUESTION SCREEN ---
        if (!activeQuestion) {
          return (
            <div className="p-8 text-red-400 border border-red-800 rounded-xl bg-red-900/20 flex items-center justify-center flex-1">
               <AlertTriangle size={24} className="mr-2" />
               Critical State Error: Status is INTERVIEWING but no Question Loaded.
            </div>
          );
        }
        return (
            <div key={activeQuestion.id} className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6 flex-1 shadow-xl shadow-black/20 animate-fade-in">
              {/* Question Header */}
              <div className="flex justify-between items-start border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-mono text-slate-500">QUESTION {engineState.turns.length + 1}</span>
                    <DifficultyBadge difficulty={activeQuestion.difficulty} />
                    <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-400 border border-slate-700">
                      Target: {activeQuestion.targetSkill}
                    </span>
                    {/* GAP BADGE */}
                    {engineState.detectedSkillGaps.some(g => g.skill.toLowerCase() === activeQuestion.targetSkill.toLowerCase()) && (
                       <span className="text-xs bg-red-900/30 text-red-400 px-2 py-1 rounded border border-red-800 font-bold">
                         SKILL GAP
                       </span>
                    )}
                  </div>
                  <h2 className="text-xl font-medium text-slate-100 leading-relaxed">
                    {activeQuestion.text}
                  </h2>
                </div>
                {renderTimer()}
              </div>

              {/* Input Area */}
              <div className="flex-1 relative group">
                <textarea 
                  className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-base font-sans focus:ring-2 focus:ring-indigo-500 outline-none resize-none leading-relaxed"
                  placeholder="Type your technical answer here..."
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleManualSubmit();
                    }
                  }}
                />
                <div className="absolute bottom-4 right-4 text-xs text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Cmd + Enter to submit
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex justify-between items-center pt-2">
                <div className="flex gap-2">
                    <button 
                      onClick={() => setUserAnswer("")}
                      className="text-xs text-slate-500 hover:text-slate-300 underline"
                    >
                      [Dev] Force Empty
                    </button>
                    <button 
                      onClick={() => setUserAnswer("I don't know the answer to this specifically.")}
                      className="text-xs text-slate-500 hover:text-slate-300 underline"
                    >
                      [Dev] Force Weak
                    </button>
                </div>
                <button 
                  onClick={handleManualSubmit}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-all flex items-center gap-2"
                >
                  Submit Answer <ChevronRight size={18} />
                </button>
              </div>
            </div>
        );

      case 'COMPLETED':
      case 'TERMINATED':
        // --- RESULTS SCREEN ---
        return (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 flex flex-col gap-6 flex-1 overflow-y-auto">
              <div className={`p-4 rounded-lg border ${engineState.status === 'COMPLETED' ? 'bg-green-900/20 border-green-800' : 'bg-red-900/20 border-red-800'} flex items-start gap-4`}>
                {engineState.status === 'COMPLETED' ? <CheckCircle className="text-green-500 shrink-0" size={32} /> : <AlertTriangle className="text-red-500 shrink-0" size={32} />}
                <div>
                  <h2 className={`text-xl font-bold ${engineState.status === 'COMPLETED' ? 'text-green-400' : 'text-red-400'}`}>
                    Interview {engineState.status === 'COMPLETED' ? 'Completed' : 'Terminated Early'}
                  </h2>
                  <p className="text-slate-400 text-sm mt-1">
                    {engineState.terminationReason || "Standard question limit reached successfully."}
                  </p>
                  {engineState.status === 'TERMINATED' && (
                     <div className="mt-2 inline-block px-2 py-1 bg-red-950 border border-red-900 rounded text-xs text-red-300 font-mono uppercase tracking-wide">
                       Policy Triggered: System Intervention
                     </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                 <div className="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <h3 className="text-slate-400 text-sm uppercase font-bold mb-4">Performance Trend</h3>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={getScoreData()}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} />
                          <YAxis domain={[0, 10]} stroke="#94a3b8" fontSize={10} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }}
                            itemStyle={{ color: '#e2e8f0' }}
                          />
                          <Area type="monotone" dataKey="score" stroke="#818cf8" fill="#4f46e5" fillOpacity={0.3} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                 </div>

                 <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 overflow-y-auto max-h-60 scrollbar-thin">
                    <h3 className="text-slate-400 text-sm uppercase font-bold mb-4">Feedback Summary</h3>
                    <ul className="space-y-3">
                      {engineState.turns.map((turn, i) => (
                        <li key={i} className="text-sm border-b border-slate-800 pb-2 last:border-0">
                          <div className="flex justify-between mb-1">
                            <span className="font-bold text-slate-300">Q{i+1}: {turn.question.targetSkill}</span>
                            <div className="flex gap-2">
                                {turn.evaluation.isFallback && <span className="text-[10px] bg-yellow-900/30 text-yellow-500 border border-yellow-800 px-1 rounded flex items-center">FB</span>}
                                {turn.evaluation.timePenalty > 0 && <span className="text-xs text-red-400 font-mono">[-TIME]</span>}
                                {turn.evaluation.skillGapPenalty && turn.evaluation.skillGapPenalty > 0 && <span className="text-xs text-red-400 font-mono">[-GAP]</span>}
                                <ScoreBadge score={turn.evaluation.finalScore} />
                            </div>
                          </div>
                          <p className="text-slate-500">{turn.evaluation.feedback}</p>
                          {turn.criticalFailure && <span className="text-red-500 text-xs font-bold">[CRITICAL FAIL +2 Strikes]</span>}
                        </li>
                      ))}
                    </ul>
                 </div>
              </div>
            </div>
        );

      default:
        return <div className="p-8 text-slate-500">System State Unknown: {engineState.status}</div>;
    }
  };


  // --- Render Helpers ---

  const getScoreData = () => {
    return engineState.scoreHistory.map((score, index) => ({
      name: `Q${index + 1}`,
      score: score,
    }));
  };

  const renderTimer = () => {
    const color = timeLeft < 10 ? 'text-red-500 animate-pulse' : timeLeft < 20 ? 'text-yellow-500' : 'text-slate-300';
    
    return (
      <div className={`flex items-center gap-2 font-mono text-xl font-bold ${color}`}>
        <Clock size={20} />
        {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
      </div>
    );
  };

  const strikeLimit = INTERVIEW_POLICY.TERMINATION.STRIKE_LIMIT;
  const currentStrikes = engineState.consecutiveWeakAnswers;
  const isStrikeExceeded = currentStrikes >= strikeLimit;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg">
            <BrainCircuit size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Hack2Hire Engine</h1>
            <p className="text-slate-400 text-sm flex items-center gap-1">
              <ShieldCheck size={14} className="text-green-400" /> 
              Policy-Driven & Deterministic
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {isFallbackMode && (
             <div className="flex items-center gap-2 px-3 py-1 bg-yellow-900/10 border border-yellow-500/30 rounded-full animate-pulse">
               <ZapOff size={14} className="text-yellow-500" />
               <span className="text-xs text-yellow-500 font-bold uppercase tracking-wider">Fallback Mode Active</span>
             </div>
          )}
          {engineState.status !== 'IDLE' && (
            <button 
              onClick={handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors text-sm"
            >
              <RotateCcw size={16} /> Reset System
            </button>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-[600px]">
        
        {/* LEFT COLUMN: Main Interaction Area */}
        <div className="lg:col-span-2 flex flex-col gap-6">
           {renderContent()}
           
           {error && (
            <div className="bg-red-900/50 border border-red-800 text-red-200 p-4 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
           )}
        </div>

        {/* RIGHT COLUMN: Engine Telemetry */}
        <div className="lg:col-span-1 flex flex-col gap-4 h-full min-h-[400px]">
           {/* Telemetry Cards */}
           <div className="grid grid-cols-2 gap-4 shrink-0">
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs font-bold uppercase mb-1">Difficulty</div>
                <div className="flex items-center gap-2">
                    <DifficultyBadge difficulty={engineState.currentDifficulty} />
                    {engineState.difficultyCeiling && <span className="text-xs text-red-400 border border-red-900 px-1 rounded" title="Capped by Policy">CAPPED</span>}
                </div>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs font-bold uppercase mb-1">Time Violations</div>
                <div className={`text-xl font-mono font-bold ${engineState.timeViolations > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {engineState.timeViolations} <span className="text-xs text-slate-600">/ {engineState.config.maxViolations}</span>
                </div>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs font-bold uppercase mb-1">Avg Score</div>
                <div className="text-xl font-mono font-bold text-indigo-400">
                  {engineState.scoreHistory.length > 0 
                    ? (engineState.scoreHistory.reduce((a,b) => a+b, 0) / engineState.scoreHistory.length).toFixed(1)
                    : '-'
                  }
                </div>
              </div>
              <div className="bg-slate-900 p-4 rounded-lg border border-slate-800">
                <div className="text-slate-500 text-xs font-bold uppercase mb-1">Strike Counter</div>
                <div className={`text-xl font-mono font-bold ${currentStrikes > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                  {isStrikeExceeded ? (
                    <span className="text-red-400 text-sm">Limit Exceeded ({currentStrikes}/{strikeLimit})</span>
                  ) : (
                    <span>{currentStrikes} <span className="text-xs text-slate-600">/ {strikeLimit}</span></span>
                  )}
                </div>
              </div>
           </div>

           {/* Detected Gaps */}
           {engineState.detectedSkillGaps.length > 0 && (
             <div className="bg-yellow-900/10 border border-yellow-800/50 p-3 rounded-lg text-xs">
                <div className="font-bold text-yellow-500 mb-2 flex items-center gap-2"><AlertTriangle size={12}/> Skill Gap Risks</div>
                <div className="space-y-2">
                    {engineState.detectedSkillGaps.map(g => (
                        <div key={g.skill} className="flex justify-between items-center border-b border-yellow-800/30 pb-1">
                            <span className="text-yellow-200">{g.skill}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${g.type === 'PRIMARY' ? 'bg-red-900 text-red-300' : 'bg-slate-800 text-slate-400'}`}>
                                {g.type}
                            </span>
                        </div>
                    ))}
                </div>
             </div>
           )}
           
           {/* Live Logs */}
           <div className="flex-1 min-h-0">
             <LogViewer logs={engineState.logs} />
           </div>
        </div>

      </main>
    </div>
  );
};

export default App;
