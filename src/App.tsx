import React, { useState, useEffect } from 'react';
import { InterviewSession } from './components/InterviewSession';
import { Question, InterviewMessage } from './types';
import { Download, FileText, User, Layout, Heart, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { loadInterviewScript } from './lib/loadScript';

const SCRIPT_PATH = '/interview_scripts/test_1.json';

export default function App() {
  const [view, setView] = useState<'setup' | 'interview' | 'results'>('setup');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [totalTimeSec, setTotalTimeSec] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<InterviewMessage[]>([]);
  const [interviewId, setInterviewId] = useState<number | null>(null);

  // Load interview script on mount
  useEffect(() => {
    loadInterviewScript(SCRIPT_PATH)
      .then(({ questions, totalTimeSec }) => {
        setQuestions(questions);
        setTotalTimeSec(totalTimeSec);
        setLoading(false);
      })
      .catch((err) => {
        setLoadError(err.message);
        setLoading(false);
      });
  }, []);

  const handleInterviewComplete = (messages: InterviewMessage[]) => {
    setResults(messages);
    setView('results');
  };

  const startNewInterview = async () => {
    try {
      const resp = await fetch('/api/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId: 'anonymous',
          scriptPath: SCRIPT_PATH,
          totalTimeSec,
        }),
      });
      if (resp.ok) {
        const { id } = await resp.json();
        setInterviewId(id);
        setView('interview');
        console.log(`Created interview session #${id}`);
      } else {
        console.warn('Failed to create interview:', resp.statusText);
        setView('interview'); // proceed anyway
      }
    } catch (err) {
      console.warn('Could not reach API server — proceeding without persistence:', err);
      setInterviewId(null);
      setView('interview');
    }
  };

  const downloadTranscript = () => {
    const transcript = results.map(m => `${m.role.toUpperCase()} (${new Date(m.timestamp).toLocaleTimeString()}): ${m.text}`).join('\n\n');
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-transcript-${new Date().toISOString()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-slate-50 text-slate-900 font-sans selection:bg-orange-100 selection:text-orange-900">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="flex items-center justify-between mb-12 border-b border-orange-100 pb-8">
          <div className="flex items-center gap-4">
            <img src="/OP_logo.png" alt="OP" className="w-12 h-12 rounded-xl shadow-md" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">OP LAB Interviewer</h1>
              <p className="text-slate-400 text-sm font-medium">AI-powered research interviews</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <img src="/female_face.svg" alt="Isabella" className="w-8 h-8 opacity-60" />
            <span className="text-xs font-medium text-slate-400">Isabella — your AI interviewer</span>
          </div>
        </header>

        <main>
          <AnimatePresence mode="wait">
            {view === 'setup' && (
              <motion.div
                key="setup"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 lg:grid-cols-3 gap-8"
              >
                <div className="lg:col-span-2 space-y-8">
                  {/* Welcome card */}
                  <section className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 rounded-2xl p-6 shadow-sm">
                    <div className="flex items-start gap-4">
                      <img src="/customer_service.svg" alt="" className="w-12 h-12 opacity-70" />
                      <div>
                        <h2 className="font-bold text-slate-800 mb-1">Welcome!</h2>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          I'm <strong>Isabella</strong>, your AI interviewer. I'll guide our conversation naturally — 
                          just speak when you're ready.
                        </p>
                      </div>
                    </div>
                  </section>

                  {/* Questions (read-only) */}
                  <section className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                      <FileText className="w-5 h-5 text-orange-400" />
                      <h2 className="text-xl font-bold text-slate-800">Interview Questions</h2>
                      <span className="ml-auto text-xs text-slate-400 font-mono">{questions.length} questions · ~{Math.ceil(totalTimeSec / 60)} min</span>
                    </div>

                    {loading && (
                      <div className="flex items-center justify-center py-12 text-slate-400">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        Loading script…
                      </div>
                    )}

                    {loadError && (
                      <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                        Failed to load interview script: {loadError}
                      </div>
                    )}

                    <div className="space-y-4">
                      {questions.map((q, index) => (
                        <div key={q.id} className="flex items-start gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                          <span className="mt-1 text-xs font-mono text-slate-400 font-bold">{String(index + 1).padStart(2, '0')}</span>
                          <div className="flex-1">
                            <p className="text-slate-700 text-sm leading-relaxed">{q.content}</p>
                            <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                              <span className="px-2 py-0.5 bg-orange-50 text-orange-600 rounded">{q.type}</span>
                              <span>{q.max_sec}s</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>

                <div className="space-y-8">
                  <section className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                      <Heart className="w-5 h-5 text-orange-400" />
                      <h2 className="text-xl font-bold text-slate-800">Ready?</h2>
                    </div>

                    <div className="space-y-6">
                      <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl">
                        <p className="text-xs text-orange-700 leading-relaxed font-medium flex items-start gap-2">
                          <Heart className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          Isabella will probe for deeper insights while keeping the conversation comfortable and within time.
                        </p>
                      </div>

                      <button
                        onClick={startNewInterview}
                        disabled={loading || !!loadError || questions.length === 0}
                        className="w-full py-4 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-100 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Start Conversation
                      </button>
                    </div>
                  </section>

                  <section className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                    <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-slate-600">
                      <Layout className="w-4 h-4 text-slate-400" />
                      System
                    </h3>
                    <ul className="space-y-3 text-xs text-slate-500">
                      <li className="flex justify-between">
                        <span>Model</span>
                        <span className="text-slate-700 font-mono">GPT Realtime</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Mode</span>
                        <span className="text-green-600 font-mono">Speech-to-Speech</span>
                      </li>
                      <li className="flex justify-between">
                        <span>Privacy</span>
                        <span className="text-slate-700 font-mono">Encrypted</span>
                      </li>
                    </ul>
                  </section>
                </div>
              </motion.div>
            )}

            {view === 'interview' && (
              <motion.div
                key="interview"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
              >
                <InterviewSession 
                  initialQuestions={questions}
                  totalTimeSec={totalTimeSec}
                  interviewId={interviewId}
                  onComplete={handleInterviewComplete}
                />
              </motion.div>
            )}

            {view === 'results' && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold text-slate-900">Conversation Transcript</h2>
                  <div className="flex gap-4">
                    <button
                      onClick={downloadTranscript}
                      className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-all shadow-sm"
                    >
                      <Download className="w-5 h-5" />
                      Download
                    </button>
                    <button
                      onClick={() => setView('setup')}
                      className="px-6 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-100"
                    >
                      New Session
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Transcript</span>
                    <span className="text-xs text-slate-400 font-mono">{results.length} exchanges</span>
                  </div>
                  <div className="p-8 space-y-8 max-h-[600px] overflow-y-auto custom-scrollbar">
                    {results.map((m) => (
                      <div key={m.id} className="flex gap-6">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden ${
                          m.role === 'interviewer' ? 'bg-orange-50' : 'bg-slate-100'
                        }`}>
                          {m.role === 'interviewer'
                            ? <img src="/female_face.svg" alt="Isabella" className="w-8 h-8" />
                            : <User className="w-5 h-5 text-slate-500" />
                          }
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`text-xs font-bold uppercase tracking-widest ${
                              m.role === 'interviewer' ? 'text-orange-600' : 'text-slate-600'
                            }`}>
                              {m.role === 'interviewer' ? 'Isabella' : 'Participant'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {new Date(m.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="text-slate-700 leading-relaxed prose prose-slate prose-sm max-w-none">
                            <ReactMarkdown>{m.text}</ReactMarkdown>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
