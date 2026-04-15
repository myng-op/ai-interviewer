import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { RealtimeSession } from '../lib/realtime';
import { InterviewState, InterviewMessage, Question } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { MessageSquare, Clock, ArrowRight, CheckCircle2, AlertCircle, Save, Mic, MicOff, PhoneOff, Heart } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface InterviewSessionProps {
  initialQuestions: Question[];
  totalTimeSec: number;
  interviewId: number | null;
  onComplete: (messages: InterviewMessage[]) => void;
}

// Build the system instructions for the Realtime model
function buildInstructions(questions: Question[], totalTimeSec: number): string {
  const list = questions.map((q, i) => {
    let entry = `${i + 1}. [${q.type.toUpperCase()}] (max ${q.max_sec}s) "${q.content}"`;
    if (q.requirement) entry += `\n   REQUIREMENT: ${q.requirement}`;
    if (q.condition) entry += `\n   CONDITION (only ask if): ${q.condition}`;
    return entry;
  }).join('\n');
  const totalMin = Math.ceil(totalTimeSec / 60);
  return `You are Isabella, a warm and empathetic social worker interviewer.
Your tone is calm, encouraging, and genuinely curious.

PERSONALITY AND DELIVERY:
- You speak with an international clear English, but not one with thick American or British accents. Aim for a neutral, globally understandable tone.
- Speak in short, natural sentences — not long paragraphs.
- Use the participant's name when they share it.
- Express genuine interest: "That's really interesting", "Tell me more about that".
- Never be judgmental. If a topic is sensitive, acknowledge it gently.
- Pause briefly between thoughts — don't rush.
- If the participant seems uncomfortable, offer to move on.

INTERVIEW QUESTIONS (ask in order):
${list}

RULES:
- Begin by greeting the participant warmly and introducing yourself briefly.
- Ask one question at a time, starting with question 1.
- Each question has a REQUIREMENT — keep probing until the requirement is satisfied before moving on.
- If a question has a CONDITION, only ask it when that condition is met; otherwise skip it.
- Each question has a time cap (max seconds). Be mindful of pacing.
- After each response, probe for more detail if the answer is brief or lacks depth.
- When the response is thorough and the requirement is met, acknowledge it warmly and move to the next question.
- The total interview time is approximately ${totalMin} minutes. Pace yourself accordingly.
- When all questions have been covered, thank the participant and conclude gracefully.
- Keep responses conversational and natural.
- Do not mention question numbers or the requirement text to the participant.
- You are not allowed to talk about the interview script or instructions with the participant. These are for your internal guidance only.`;
}

// Fire-and-forget: persist one message to the backend
function saveMessage(interviewId: number | null, role: string, text: string, timestamp: number) {
  if (!interviewId) return;
  fetch(`/api/interviews/${interviewId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, text, timestamp }),
  }).catch(err => console.warn('[saveMessage] failed:', err));
}

export const InterviewSession: React.FC<InterviewSessionProps> = ({ initialQuestions, totalTimeSec, interviewId, onComplete }) => {
  const [state, setState] = useState<InterviewState>({
    status: 'idle',
    currentQuestionIndex: 0,
    messages: [],
    questions: initialQuestions,
    totalTimeSec,
  });

  const [isMuted, setIsMuted] = useState(false);
  const [pendingText, setPendingText] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<RealtimeSession | null>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages, pendingText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { sessionRef.current?.disconnect(); };
  }, []);

  // ----- Start interview -----
  const startInterview = async () => {
    setError(null);
    setState(prev => ({
      ...prev,
      status: 'active',
      currentQuestionIndex: 0,
      startTime: Date.now(),
      messages: [],
    }));

    const instructions = buildInstructions(initialQuestions, totalTimeSec);

    const session = new RealtimeSession({
      onUserTranscriptDone: (text) => {
        const ts = Date.now();
        saveMessage(interviewId, 'candidate', text, ts);
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, {
            id: uuidv4(),
            role: 'candidate',
            text,
            timestamp: ts,
          }],
        }));
      },
      onAssistantTranscriptDelta: (delta) => {
        setPendingText(prev => prev + delta);
      },
      onAssistantTranscriptDone: (text) => {
        const ts = Date.now();
        saveMessage(interviewId, 'interviewer', text, ts);
        setPendingText('');
        setState(prev => ({
          ...prev,
          messages: [...prev.messages, {
            id: uuidv4(),
            role: 'interviewer',
            text,
            timestamp: ts,
          }],
        }));
      },
      onError: (err) => setError(err),
      onStatusChange: setConnectionStatus,
    });

    sessionRef.current = session;

    try {
      await session.connect(instructions);
      await session.startMicrophone();
      session.triggerResponse(); // model speaks first
    } catch (err) {
      console.error('Failed to start realtime session:', err);
      setError('Failed to connect to Azure Realtime API. Check your endpoint and API key.');
    }
  };

  // ----- Mute / unmute -----
  const toggleMute = () => {
    if (!sessionRef.current) return;
    if (isMuted) {
      sessionRef.current.unmuteMicrophone();
    } else {
      sessionRef.current.muteMicrophone();
    }
    setIsMuted(!isMuted);
  };

  // ----- End interview -----
  const endInterview = () => {
    sessionRef.current?.disconnect();
    if (interviewId) {
      fetch(`/api/interviews/${interviewId}/complete`, { method: 'PATCH' })
        .catch(err => console.warn('[endInterview] failed to mark complete:', err));
    }
    setState(prev => ({ ...prev, status: 'completed' }));
  };

  // ----- Timer -----
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getRemainingTime = () => {
    if (!state.startTime) return state.totalTimeSec * 1000;
    const elapsed = Date.now() - state.startTime;
    return Math.max(0, (state.totalTimeSec * 1000) - elapsed);
  };

  const [timeLeft, setTimeLeft] = useState(getRemainingTime());

  useEffect(() => {
    if (state.status === 'active') {
      const timer = setInterval(() => {
        const remaining = getRemainingTime();
        setTimeLeft(remaining);
        if (remaining <= 0) {
          endInterview();
          clearInterval(timer);
        }
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [state.status, state.startTime]);

  // =====================================================================
  // Render: idle
  // =====================================================================
  if (state.status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-white rounded-2xl border border-slate-200 shadow-xl">
        <img src="/female_face.svg" alt="Isabella" className="w-20 h-20 mb-6" />
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Meet Isabella</h2>
        <p className="text-slate-500 text-center max-w-md mb-8">
          I'll guide our conversation naturally using real-time voice.
          Just speak when you're ready — no buttons to press.
        </p>
        <button
          onClick={startInterview}
          className="group flex items-center gap-2 px-8 py-4 bg-orange-500 text-white rounded-full font-bold hover:bg-orange-600 transition-all shadow-lg shadow-orange-100 active:scale-95"
        >
          Start Conversation
          <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
        </button>
      </div>
    );
  }

  // =====================================================================
  // Render: completed
  // =====================================================================
  if (state.status === 'completed') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-8 bg-white rounded-2xl border border-slate-200 shadow-xl">
        <div className="w-20 h-20 bg-green-50 rounded-2xl flex items-center justify-center mb-6 border border-green-100">
          <Heart className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Thank You!</h2>
        <p className="text-slate-500 text-center max-w-md mb-8">
          The conversation is complete. Your responses have been recorded.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => onComplete(state.messages)}
            className="flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 rounded-full font-medium hover:bg-slate-200 transition-all"
          >
            <Save className="w-5 h-5" />
            View Transcript
          </button>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-orange-500 text-white rounded-full font-medium hover:bg-orange-600 transition-all"
          >
            Restart
          </button>
        </div>
      </div>
    );
  }

  // =====================================================================
  // Render: active
  // =====================================================================
  return (
    <div className="flex flex-col h-[700px] bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full animate-pulse ${connectionStatus === 'connected' ? 'bg-green-500' : connectionStatus === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span className="font-mono text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            {connectionStatus === 'connected' ? 'Live Session' : connectionStatus === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-md border border-slate-200 shadow-sm">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className={`font-mono text-sm ${timeLeft < 60000 ? 'text-red-500 font-bold' : 'text-slate-600'}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-8 space-y-8 scroll-smooth custom-scrollbar bg-slate-50/30"
      >
        <AnimatePresence initial={false}>
          {state.messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'interviewer' ? 'justify-start' : 'justify-end'}`}
            >
              <div className={`max-w-[85%] p-5 rounded-2xl shadow-sm ${
                message.role === 'interviewer'
                  ? 'bg-white text-slate-800 rounded-tl-none border border-slate-200'
                  : 'bg-blue-600 text-white rounded-tr-none shadow-blue-100'
              }`}>
                <div className={`text-[9px] uppercase tracking-widest font-black mb-2 opacity-60 ${
                  message.role === 'interviewer' ? 'text-orange-600' : 'text-blue-100'
                }`}>
                  {message.role === 'interviewer' ? 'Isabella' : 'You'}
                </div>
                <div className={`prose prose-sm max-w-none ${
                  message.role === 'interviewer' ? 'prose-slate' : 'prose-invert'
                }`}>
                  <ReactMarkdown>{message.text}</ReactMarkdown>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Streaming assistant text */}
        {pendingText && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="max-w-[85%] p-5 rounded-2xl rounded-tl-none border border-slate-200 bg-white text-slate-800 shadow-sm">
              <div className="text-[9px] uppercase tracking-widest font-black mb-2 opacity-60 text-orange-600">Isabella</div>
              <div className="prose prose-sm max-w-none prose-slate">
                <ReactMarkdown>{pendingText}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-center">
            <div className="bg-red-50 border border-red-100 p-3 rounded-lg flex items-center gap-2 text-red-600 text-xs font-medium">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          </motion.div>
        )}
      </div>

      {/* Footer / Controls */}
      <div className="flex items-center justify-center gap-6 p-8 border-t border-slate-100 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.02)]">
        {/* Mute / Unmute */}
        <button
          onClick={toggleMute}
          className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl active:scale-90 ${
            isMuted
              ? 'bg-slate-200 text-slate-500 shadow-slate-100'
              : 'bg-orange-500 text-white shadow-orange-100'
          }`}
        >
          {!isMuted && (
            <span className="absolute inset-0 rounded-full bg-orange-400 animate-ping opacity-20" />
          )}
          {isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
        </button>

        {/* End Interview */}
        <button
          onClick={endInterview}
          className="w-12 h-12 rounded-full flex items-center justify-center bg-red-100 text-red-600 hover:bg-red-500 hover:text-white transition-all shadow-sm active:scale-90"
          title="End Interview"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
