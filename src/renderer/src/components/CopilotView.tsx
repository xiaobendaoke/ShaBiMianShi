import { AnswerContent } from './AnswerContent';
import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Square,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ExternalLink,
  Mic,
  MicOff,
  Sparkles,
  Info,
  CheckCircle2,
  BookOpen,
  Layers,
  FileSearch,
  Camera,
  Crop,
  Loader2,
  X,
  Pause,
  Play,
  Zap,
  AlertCircle
} from 'lucide-react';
import { SessionRecord, TurnRecord, CitationSnapshot, Library, ChunkRecord, ImageAttachment, AnswerOptions } from '../../../main/types';

import {MemoryPanel} from './MemoryPanel';
import { AudioPanel } from './AudioPanel';

interface CopilotViewProps {
  currentSession: SessionRecord | null;
  libraries: Library[];
  onSessionChange?: (session: SessionRecord) => void;
}

export const CopilotView: React.FC<CopilotViewProps> = ({ currentSession, libraries, onSessionChange }) => {
  const [questionInput, setQuestionInput] = useState('');
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [currentTurn, setCurrentTurn] = useState<TurnRecord | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<CitationSnapshot | null>(null);

  // Active library search scope for this conversation (P1-03)
  const [activeLibraryIds, setActiveLibraryIds] = useState<string[]>([]);

  // Citation inspector details (P1-05)
  const [neighborChunks, setNeighborChunks] = useState<ChunkRecord[] | null>(null);
  const [fullDocText, setFullDocText] = useState<string | null>(null);
  const [inspectorMode, setInspectorMode] = useState<'snippet' | 'neighbors' | 'full'>('snippet');

  // Column collapsible states
  const [showLeftCol, setShowLeftCol] = useState(true);
  const [showRightCol, setShowRightCol] = useState(false);

  const [isCapturing, setIsCapturing] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [deepThinking, setDeepThinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shortcutFailures, setShortcutFailures] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  const commandRef = useRef<(command: string) => void>(() => {});
  const answerScrollRef = useRef<HTMLDivElement>(null);

  const activeTurnRef = useRef<{ sessionId: string; turnId: string } | null>(null);
  const stoppedTurnsRef = useRef(new Set<string>());
  const currentSessionRef = useRef(currentSession?.id);
  currentSessionRef.current = currentSession?.id;

  useEffect(() => {
    let mounted = true;
    const sessionId = currentSession?.id;
    activeTurnRef.current = null;
    setIsGenerating(false); setTurns([]); setCurrentTurn(null); setImages([]); setPreview(null); setErrorMessage(''); setQuestionInput(''); setSelectedCitation(null); setNeighborChunks(null); setFullDocText(null);
    if (sessionId) void (async () => {
      try {
        await (window as any).api.selectSession?.(sessionId);
        const records: TurnRecord[] = await (window as any).api.getTurns(sessionId);
        const snapshot: TurnRecord | null = await (window as any).api.getActiveTurn?.() ?? null;
        if (!mounted || activeTurnRef.current || currentSessionRef.current !== sessionId) return;
        const latest = snapshot?.sessionId === sessionId ? snapshot : records.at(-1) ?? null;
        setTurns(records); setCurrentTurn(latest);
        if (latest?.status === 'streaming' && !stoppedTurnsRef.current.has(latest.id)) {
          activeTurnRef.current = { sessionId, turnId: latest.id };
          setIsGenerating(true);
        }
      } catch (error) { console.warn('无法读取会话', error); }
    })();
    return () => { mounted = false; };
  }, [currentSession?.id]);

  useEffect(() => { setActiveLibraryIds(currentSession?.libraryIds ?? []); }, [currentSession?.libraryIds]);

  useEffect(() => {
    const accepts = (payload: any) => {
      const active = activeTurnRef.current;
      return active && payload?.sessionId === active.sessionId && payload?.turnId === active.turnId &&
        currentSessionRef.current === active.sessionId && !stoppedTurnsRef.current.has(active.turnId);
    };
    const unsubStart = (window as any).api.onChatStreamStart?.((payload: any) => {
      if (payload.sessionId !== currentSessionRef.current) return;
      activeTurnRef.current = {sessionId: payload.sessionId, turnId: payload.turnId};
      setIsGenerating(true);
      const turn = payload.turn || {id: payload.turnId, sessionId: payload.sessionId, question: payload.question, role: 'assistant', answer: '', status: 'streaming', citations: [], createdAt: payload.createdAt};
      setTurns(rows => [...rows.filter(t => t.id !== turn.id), turn]); setCurrentTurn(turn);
    });
    const unsubQueued = (window as any).api.onChatQueued?.((payload: any) => {
      if (payload.sessionId === currentSessionRef.current) void (window as any).api.getTurns(payload.sessionId).then((rows: TurnRecord[]) => {if(currentSessionRef.current === payload.sessionId) setTurns(previous=>rows.map(row=>{const live=previous.find(t=>t.id===row.id);return live?.status==='streaming'&&row.status==='streaming'?live:row;}));});
    });
    const offBusy = (window as any).api.onScreenBusy?.(setIsCapturing);
    const offPreview = (window as any).api.onScreenPreview?.((p: any) => {if(p.sessionId===currentSessionRef.current) setPreview(p.image);});
    const offScreenError = (window as any).api.onScreenError?.((p: any) => setErrorMessage(p.error));
    const offCommand = (window as any).api.onInterviewCommand?.((c: string) => commandRef.current(c));
    void (window as any).api.getShortcutFailures?.().then(setShortcutFailures);
    const offReset = (window as any).api.onChatReset?.((payload: any) => {
      if (!accepts(payload)) return;
      setTurns(rows=>rows.map(t=>t.id===payload.turnId?{...t,answer:''}:t));
      setCurrentTurn(t=>t && t.id===payload.turnId?{...t,answer:''}:t);
    });
    const offProgress=(window as any).api.onChatProgress?.((payload:any)=>{
      if(!accepts(payload))return;
      const update=(t:TurnRecord)=>t.id===payload.turnId?{...t,timings:payload.timings}:t;
      setTurns(rows=>rows.map(update));setCurrentTurn(t=>t?update(t):t);
    });
    const unsubToken = (window as any).api.onChatStreamToken((payload: any) => {
      if (!accepts(payload) || typeof payload.token !== 'string') return;
      const append = (turn: TurnRecord) => turn.id === payload.turnId
        ? { ...turn, answer: turn.answer + payload.token, timings:payload.timings || turn.timings, status: 'streaming' as const } : turn;
      setTurns(prev => prev.map(append));
      setCurrentTurn(prev => prev ? append(prev) : prev);
    });
    const unsubComplete = (window as any).api.onChatStreamComplete((payload: any) => {
      if (!accepts(payload) || payload.turn?.id !== payload.turnId) return;
      activeTurnRef.current = null;
      setIsGenerating(false);
      setTurns(prev => prev.map(turn => turn.id === payload.turnId ? payload.turn : turn));
      setCurrentTurn(prev => prev?.id === payload.turnId ? payload.turn : prev);
    });
    const unsubError = (window as any).api.onChatStreamError((payload: any) => {
      if (!accepts(payload)) {
        if (payload.sessionId === currentSessionRef.current) setTurns(rows=>rows.map(t=>t.id===payload.turnId&&t.status==='queued'?{...t,status:payload.status==='cancelled'?'cancelled':'error',error:payload.error}:t));
        return;
      }
      activeTurnRef.current = null; setIsGenerating(false);
      const status = payload.status === 'cancelled' ? 'cancelled' as const : 'error' as const;
      const update = (turn: TurnRecord) => turn.id === payload.turnId ? { ...turn, status, error: payload.error } : turn;
      setTurns(prev => prev.map(update));
      setCurrentTurn(prev => prev ? update(prev) : prev);
      if (status !== 'cancelled') setErrorMessage(`生成失败: ${payload.error}`);
    });
    const unsubQuestionExtracted = (window as any).api.onQuestionExtracted?.((payload: any) => {
      if (payload?.question) {
        setQuestionInput(payload.question);
      }
    });
    return () => { unsubStart?.(); offProgress?.(); offReset?.(); unsubQueued?.(); offBusy?.(); offPreview?.(); offScreenError?.(); offCommand?.(); unsubToken(); unsubComplete(); unsubError(); unsubQuestionExtracted?.(); };
  }, []);

  const toggleLibraryScope = (libId: string) => {
    let next: string[];
    if (activeLibraryIds.includes(libId)) {
      next = activeLibraryIds.filter(id => id !== libId);
    } else {
      next = [...activeLibraryIds, libId];
    }
    setActiveLibraryIds(next);

    // Persist to session
    if (currentSession) {
      const updated = { ...currentSession, libraryIds: next, updatedAt: Date.now() };
      onSessionChange?.(updated);
      (window as any).api.saveSession(updated);
    }
  };

  const handleSend = async (textToSend?: string, suppliedOptions?: AnswerOptions) => {
    const q = (textToSend || questionInput || (images.length ? '请解答截图中的题目，给出完整代码。' : '')).trim();
    if (!q || !currentSession) return;
    const queued = !!activeTurnRef.current;
    const options: AnswerOptions = suppliedOptions || {images, language: currentSession.language || 'C17', deepThinking};
    setErrorMessage('');

    if (!queued) setIsGenerating(true);
    setQuestionInput(''); setImages([]);

    // Optimistic turn with synchronized UUID
    const tempTurnId = `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const tempTurn: TurnRecord = {
      id: tempTurnId,
      sessionId: currentSession.id,
      role: 'assistant',
      question: q,
      answer: '',
      status: queued ? 'queued' : 'streaming',
      options,
      citations: [],
      createdAt: Date.now()
    };
    if (!queued) activeTurnRef.current = { sessionId: currentSession.id, turnId: tempTurnId };
    setTurns(prev => [...prev, tempTurn]);
    setCurrentTurn(tempTurn);

    try {
      const realTurnId = await (window as any).api.askQuestion(currentSession.id, q, activeLibraryIds, tempTurnId, options);
      if (activeTurnRef.current?.turnId === tempTurnId && realTurnId && realTurnId !== tempTurnId) {
        activeTurnRef.current.turnId = realTurnId;
        setTurns(prev => prev.map(t => t.id === tempTurnId ? { ...t, id: realTurnId } : t));
        setCurrentTurn(prev => (prev && prev.id === tempTurnId ? { ...prev, id: realTurnId } : prev));
      }
    } catch (err: any) {
      if (activeTurnRef.current?.turnId === tempTurnId) {activeTurnRef.current = null; setIsGenerating(false);}
      setTurns(prev => prev.map(t => t.id === tempTurnId ? { ...t, status: 'error' } : t));
      setCurrentTurn(prev => prev?.id === tempTurnId ? { ...prev, status: 'error' } : prev);
      setErrorMessage(err.message || '提问失败');
    }
  };

  const handleStop = () => {
    const active = activeTurnRef.current;
    if (!active) return;
    stoppedTurnsRef.current.add(active.turnId);
    activeTurnRef.current = null;
    const cancel = (turn: TurnRecord) => turn.id === active.turnId ? { ...turn, status: 'cancelled' as const } : turn;
    setTurns(prev => prev.map(cancel));
    setCurrentTurn(prev => prev ? cancel(prev) : prev);
    setIsGenerating(false);
    void (window as any).api.cancelGeneration(active.turnId, active.sessionId);
  };

  const handleCopy = () => {
    if (currentTurn?.answer) {
      navigator.clipboard.writeText(currentTurn.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleScreenCapture = async (mode: 'interactive' | 'fullscreen' = 'interactive', append = false) => {
    if (!currentSession || isCapturing) return;
    const sessionId = currentSession.id;
    setIsCapturing(true); setErrorMessage('');
    try {
      if (append) {
        const image = await (window as any).api.captureScreen(mode);
        if (image && currentSessionRef.current === sessionId) setImages(previous => previous.length < 8 ? [...previous, {...image, id: crypto.randomUUID()}] : previous);
      } else await (window as any).api.captureAndAsk(mode, sessionId, activeLibraryIds);
    } catch (err: any) {setErrorMessage(`截屏失败: ${err.message}`);}
    finally {setIsCapturing(false);}
  };
  commandRef.current = command => {
    if (command === 'scroll-up') answerScrollRef.current?.scrollBy({top: -160});
    if (command === 'scroll-down') answerScrollRef.current?.scrollBy({top: 160});
    const index = turns.findIndex(t => t.id === currentTurn?.id);
    if (command === 'previous' && index > 0) setCurrentTurn(turns[index-1]);
    if (command === 'next' && index < turns.length-1) setCurrentTurn(turns[index+1]);
  };
  const saveSessionFields = (fields: Partial<SessionRecord>) => {
    if (!currentSession) return;
    const updated = {...currentSession, ...fields, updatedAt: Date.now()}; onSessionChange?.(updated); void (window as any).api.saveSession(updated);
  };
  const nextQuestion = async () => {
    const queued = turns.find(t => t.status === 'queued'); if (!queued) return;
    if (activeTurnRef.current) await (window as any).api.cancelGeneration(activeTurnRef.current.turnId, activeTurnRef.current.sessionId);
  };

  const openCitationInspector = (cite: CitationSnapshot) => {
    setSelectedCitation(cite);
    setNeighborChunks(null);
    setFullDocText(null);
    setInspectorMode('snippet');
  };

  const loadNeighbors = async () => {
    if (!selectedCitation?.chunkId) return;
    setInspectorMode('neighbors');
    try {
      const res = await (window as any).api.getChunkNeighbors(selectedCitation.chunkId, 1, 1);
      setNeighborChunks(res);
    } catch (err) {
      console.warn('Failed to load neighbor chunks:', err);
    }
  };

  const loadFullDoc = async () => {
    if (!selectedCitation?.documentId) return;
    setInspectorMode('full');
    try {
      const res = await (window as any).api.getDocumentText(selectedCitation.documentId);
      setFullDocText(res);
    } catch (err) {
      console.warn('Failed to load full document text:', err);
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-900">
      {/* LEFT COLUMN: Question & Audio Input */}
      {showLeftCol ? (
        <div className="w-80 border-r border-gray-800 flex flex-col justify-between bg-gray-950/60 p-4 shrink-0 transition-all">
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-300">问题录入 / 转写</span>
              <button
                onClick={() => setShowLeftCol(false)}
                className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-800"
                title="折叠问题栏"
              >
                <ChevronLeft size={16} />
              </button>
            </div>

            {/* Turn History / Selector */}
            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              <div className="text-[11px] text-gray-500 font-medium px-1">本场会话问答历史 ({turns.length})</div>
              {turns.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500 bg-gray-900/40 rounded-lg border border-dashed border-gray-800">
                  暂无问答记录，输入问题或点击录音开始
                </div>
              ) : (
                turns.map((turn, i) => (
                  <button
                    key={turn.id}
                    onClick={() => setCurrentTurn(turn)}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition-all border ${
                      currentTurn?.id === turn.id
                        ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                        : 'bg-gray-900/60 border-gray-800 text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                    }`}
                  >
                    <div className="font-medium line-clamp-2">
                      {i + 1}. {turn.topic || turn.question}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1 flex items-center justify-between">
                      <span>{new Date(turn.createdAt).toLocaleTimeString()}</span>
                      {turn.citations.length > 0 && (
                        <span className="text-emerald-400">
                          {turn.citations.filter(c => c.isVerified).length || turn.citations.length} 处参考资料
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Input & Action area */}
            <div className="pt-3 border-t border-gray-800 space-y-2">
              {shortcutFailures.length > 0 && (
                <p className="text-[11px] text-amber-300 leading-tight">快捷键冲突：{shortcutFailures.join('、')}</p>
              )}
              {errorMessage && (
                <p role="alert" className="text-[11px] text-red-300 leading-tight">{errorMessage}</p>
              )}

              {/* Pending / Queued Alert */}
              {turns.some(t => t.status === 'queued') && (
                <div className="flex items-center justify-between p-1.5 bg-amber-950/40 border border-amber-800/60 rounded text-[11px] text-amber-300">
                  <span>待答 {turns.filter(t => t.status === 'queued').length} 题</span>
                  <div className="flex space-x-1">
                    <button onClick={() => void nextQuestion()} className="underline hover:text-amber-200">下一题</button>
                    <button
                      onClick={() => {
                        void (async () => {
                          for (const t of turns.filter(t => t.status === 'queued')) await (window as any).api.cancelGeneration(t.id, t.sessionId);
                          const rows = await (window as any).api.getTurns(currentSession?.id);
                          setTurns(rows);
                        })();
                      }}
                      className="underline hover:text-amber-200"
                    >
                      清空
                    </button>
                  </div>
                </div>
              )}

              {/* Attached Screenshots Preview */}
              {images.length > 0 && (
                <div className="p-2 bg-gray-900 border border-gray-700/80 rounded-lg space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-gray-300">
                    <span>已截取 {images.length} 张图片</span>
                    <button
                      onClick={() => void handleSend()}
                      className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors"
                    >
                      确认提交解题 ↵
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {images.map(image => (
                      <div key={image.id} className="relative group">
                        <img
                          className="h-12 max-w-24 object-contain rounded border border-gray-700 bg-black/40"
                          src={`data:${image.mimeType};base64,${image.base64}`}
                          alt="待提交截图"
                        />
                        <button
                          className="absolute -top-1 -right-1 bg-red-600 hover:bg-red-500 text-white rounded-full p-0.5 shadow-md"
                          onClick={() => setImages(rows => rows.filter(i => i.id !== image.id))}
                          title="删除图片"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview && (
                <details className="text-[11px] text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-300">最近截图 · 点击预览</summary>
                  <div className="pt-1">
                    <img className="max-h-36 rounded border border-gray-800" alt="最近截图" src={`data:${preview.mimeType};base64,${preview.base64}`} />
                    <button
                      onClick={() => void handleScreenCapture('interactive')}
                      className="mt-1 text-emerald-400 hover:underline text-[11px] block"
                    >
                      重新选区解题
                    </button>
                  </div>
                </details>
              )}

              {/* Language Selection & Deep Thinking */}
              <div className="flex items-center justify-between text-xs text-gray-400 px-0.5">
                <div className="flex items-center space-x-1.5">
                  <span className="text-[11px] text-gray-500">语言:</span>
                  <select
                    aria-label="编程语言"
                    className="bg-gray-800 text-gray-300 rounded px-1.5 py-0.5 text-[11px] border border-gray-700 focus:outline-none focus:border-emerald-500"
                    value={currentSession?.language || 'C17'}
                    onChange={e => saveSessionFields({ language: e.target.value })}
                  >
                    {['C17', 'C++17', 'Java', 'Python', 'JavaScript', 'TypeScript', 'Go'].map(lang => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center space-x-1 cursor-pointer text-[11px] hover:text-gray-300">
                  <input
                    type="checkbox"
                    checked={deepThinking}
                    onChange={e => setDeepThinking(e.target.checked)}
                    className="rounded accent-emerald-500 w-3 h-3"
                  />
                  <span>深入解题</span>
                </label>
              </div>

              {/* Text Input Area */}
              <div className="relative">
                <textarea
                  value={questionInput}
                  onChange={e => setQuestionInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入面试官问题，如：订单重复提交如何保证接口幂等性？"
                  rows={3}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none"
                />
                <button
                  disabled={!questionInput.trim() && !images.length}
                  onClick={() => handleSend()}
                  className="absolute right-2 bottom-2 p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white rounded-md transition-colors shadow-sm"
                  title="发送问题 (Enter)"
                >
                  <Send size={13} />
                </button>
              </div>

              {/* Foldable Resume Facts & Session Memory */}
              <details className="text-[11px] text-gray-500">
                <summary className="cursor-pointer hover:text-gray-400 py-0.5">简历事实与会话记忆 ▾</summary>
                <div className="pt-2 space-y-2">
                  <MemoryPanel sessionId={currentSession?.id} />
                  <textarea
                    className="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-300 text-[11px] focus:outline-none focus:border-emerald-600"
                    placeholder="填写本人负责的项目、职责、可核实结果"
                    defaultValue={currentSession?.projectFacts || ''}
                    key={`${currentSession?.id}-facts`}
                    rows={2}
                    onBlur={e => saveSessionFields({ projectFacts: e.target.value })}
                  />
                  <textarea
                    className="w-full bg-gray-900 border border-gray-800 rounded p-1.5 text-gray-300 text-[11px] focus:outline-none focus:border-emerald-600"
                    placeholder="目标职位 / JD"
                    defaultValue={currentSession?.jobDescription || ''}
                    key={`${currentSession?.id}-jd`}
                    rows={2}
                    onBlur={e => saveSessionFields({ jobDescription: e.target.value })}
                  />
                </div>
              </details>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowLeftCol(true)}
          className="w-7 border-r border-gray-800 bg-gray-950 flex flex-col items-center py-4 text-gray-400 hover:text-gray-200"
          title="展开问题栏"
        >
          <ChevronRight size={16} />
        </button>
      )}

      {/* MIDDLE COLUMN: Streaming Answer & KB Scope Selector & Action Center */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden bg-gray-900 p-6">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Top Bar: Knowledge Base Search Scope Selector & Microphone/Capture Action Center */}
          <div className="pb-3 border-b border-gray-800 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-2.5">
              <div className="flex items-center space-x-2">
                <BookOpen size={14} className="text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-gray-300">知识库：</span>
                {libraries.length === 0 ? (
                  <span className="text-[11px] text-gray-500">暂无知识库</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {libraries.map(lib => {
                      const isSelected = activeLibraryIds.includes(lib.id);
                      return (
                        <button
                          key={lib.id}
                          onClick={() => toggleLibraryScope(lib.id)}
                          className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors border flex items-center space-x-1 ${
                            isSelected
                              ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                              : 'bg-gray-800/60 border-gray-700 text-gray-500 hover:text-gray-300'
                          }`}
                        >
                          {isSelected && <Check size={11} />}
                          <span>{lib.name}</span>
                          <span className="text-[10px] opacity-70">({lib.docCount}篇)</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {activeLibraryIds.length === 0 && (
                  <span className="text-[11px] text-amber-400 font-medium">
                    ⚠️ 未选知识库
                  </span>
                )}
              </div>

              {/* Action Center: Audio + Screen Capture */}
              <div className="flex items-center space-x-2.5">
                <AudioPanel sessionId={currentSession?.id} edit={setQuestionInput} />

                <div className="h-4 w-px bg-gray-800 hidden sm:block" />

                <div className="flex items-center space-x-1">
                  <button
                    disabled={isCapturing}
                    onClick={() => void handleScreenCapture('interactive')}
                    className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 border border-gray-700 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    title="选区截图解题 (快捷键: Cmd+Alt+X)"
                  >
                    <Crop size={13} className="text-emerald-400" />
                    <span>选区解题</span>
                  </button>

                  <button
                    disabled={isCapturing}
                    onClick={() => void handleScreenCapture('fullscreen')}
                    className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    title="全屏截图解题 (快捷键: Cmd+Shift+S)"
                  >
                    <Camera size={13} />
                    <span>全屏</span>
                  </button>

                  <button
                    disabled={isCapturing || images.length >= 8}
                    onClick={() => void handleScreenCapture('interactive', true)}
                    className="flex items-center space-x-1 px-2 py-1.5 bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-gray-200 border border-gray-700/80 rounded-lg text-xs transition-colors disabled:opacity-40"
                    title="追加截图 (最多8张)"
                  >
                    <span>+截屏</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {currentTurn ? (
            <div className="flex flex-col flex-1 overflow-hidden pt-3">
              {/* Question Header & Actions */}
              <div className="pb-3 border-b border-gray-800/60 flex items-center justify-between shrink-0">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 font-medium">
                      当前问题
                    </span>
                    <span className="text-xs text-gray-400">
                      {currentTurn.status === 'streaming'
                        ? '正在生成回答…'
                        : currentTurn.status === 'cancelled'
                        ? '回答已取消'
                        : currentTurn.status === 'queued' ? '等待上一题完成' : currentTurn.status === 'error' ? '生成失败' : '回答完成'}
                    </span>
                  </div>
                  <h2 className="text-sm font-semibold text-gray-100">{currentTurn.topic || currentTurn.question}</h2>
                </div>

                <div className="flex items-center space-x-2">
                  {isGenerating ? (
                    <button
                      onClick={handleStop}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-900/50 hover:bg-red-800/60 border border-red-700 text-red-300 rounded-md text-xs transition-colors"
                    >
                      <Square size={13} />
                      <span>停止回答</span>
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleCopy}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-md text-xs transition-colors"
                      >
                        {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                        <span>{copied ? '已复制' : '复制回答'}</span>
                      </button>
                      <button
                        onClick={() => handleSend(currentTurn.question, currentTurn.options)}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs transition-colors"
                      >
                        <Sparkles size={13} />
                        <span>重新回答</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-3 py-2 text-xs text-emerald-400">
                <button disabled={isGenerating} onClick={()=>void handleSend(`请将下面的回答压缩成一句话。问题：${currentTurn.question}。回答：${currentTurn.answer}`, {action:'shorten'})}>再短一点</button>
                <button disabled={isGenerating} onClick={()=>void handleSend(`请展开解释这道题。问题：${currentTurn.question}。已有回答：${currentTurn.answer}`, {action:'explain'})}>展开解释</button>
                <button disabled={isGenerating} onClick={()=>void handleSend(questionInput || '请结合上一版代码和本次截图或报错调试，给出完整修正版。', {action:'debug', images:images.length?images:currentTurn.options?.images, language:currentSession?.language || 'C17', deepThinking})}>调试提交</button>
                <button disabled={!images.length || isGenerating} onClick={()=>void handleSend('只提取图片中的完整题目。', {action:'extract', images})}>只提取题目</button>
                <button onClick={()=>commandRef.current('previous')}>上一题</button><button onClick={()=>commandRef.current('next')}>下一题</button>
                <button onClick={()=>void (window as any).api.clearAttachments(currentSession?.id).then(()=>{setPreview(null);setImages([]);return (window as any).api.getTurns(currentSession?.id);}).then(setTurns).catch((e:any)=>setErrorMessage(e.message))}>清理本场截图</button>
              </div>
              {!!currentTurn.options?.images?.length && <details className="text-xs text-gray-400"><summary>本题截图（{currentTurn.options.images.length}张） · 语言按题目要求优先，否则 {currentTurn.options.language || currentSession?.language || 'C17'}</summary><div className="flex overflow-auto">{currentTurn.options.images.map(image=><img key={image.id} className="max-h-48" src={`data:${image.mimeType};base64,${image.base64}`} alt="本题截图"/>)}</div></details>}
              {currentTurn.timings && <p className="text-[10px] text-gray-500">首字 {currentTurn.timings.firstTokenMs ?? '等待'}ms · 总耗时 {currentTurn.timings.totalMs ?? '进行中'}ms · 排队 {currentTurn.timings.queuedMs ?? 0}ms{currentTurn.timings.speechToSubmitMs !== undefined && <> · 说完至提交 {currentTurn.timings.speechToSubmitMs}ms</>}{currentTurn.timings.retrievalMs !== undefined && <> · 上下文准备 {currentTurn.timings.retrievalMs}ms</>}{currentTurn.timings.responseMs !== undefined && <> · 接口响应头 {currentTurn.timings.responseMs}ms · {currentTurn.timings.streaming?'流式返回':'整段返回'} · 请求{currentTurn.timings.attempts}次</>}{currentTurn.timings.speechToFirstTokenMs !== undefined && <> · 说完至首字 {currentTurn.timings.speechToFirstTokenMs}ms</>}</p>}
              {currentTurn.retrieval&&<details className="text-xs text-gray-400 py-2"><summary className="cursor-pointer">检索依据 · {currentTurn.retrieval.name||'未限定项目'} · {currentTurn.retrieval.items.length}段</summary><p>{currentTurn.retrieval.reason}</p><ul className="list-disc pl-4">{currentTurn.retrieval.items.map(item=><li key={item.chunkId}>{item.fileName} / {item.sectionPath}（{item.chars}字）</li>)}</ul>{currentTurn.retrieval.omitted.map((text,i)=><p className="text-amber-300" key={i}>{text}</p>)}</details>}
              {currentTurn.error && <p className="text-xs text-red-300">{currentTurn.error}</p>}
              {/* Answer Stream Body */}
              <div ref={answerScrollRef} className="flex-1 overflow-y-auto py-4 pr-2">
                {currentTurn.citationWarning && (
                  <div className="mb-3 p-2.5 bg-amber-950/70 border border-amber-600/70 rounded-lg text-xs text-amber-200 flex items-start space-x-2">
                    <span className="shrink-0 text-amber-400">⚠️</span>
                    <div className="leading-snug">{currentTurn.citationWarning}</div>
                  </div>
                )}
                {currentTurn.options?.action === 'explain' ? <details className="text-xs text-gray-200"><summary className="text-emerald-400 cursor-pointer">解析（点击展开）</summary><div className="py-3"><AnswerContent text={currentTurn.answer || '正在生成解释…'}/></div></details> : <>
                <div className="max-w-[76ch] min-w-0">
                  {currentTurn.answer ? <AnswerContent text={currentTurn.answer}/> : (isGenerating && (
                    <div className="flex items-center space-x-2 text-gray-400 py-4">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      <span>正在生成回答；若服务不支持流式输出，请等待完整结果…</span>
                    </div>
                  ))}
                </div></>}

              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center text-emerald-400">
                <Sparkles size={24} />
              </div>
              <h3 className="text-sm font-medium text-gray-200">准备就绪，随时提问</h3>
              <p className="text-xs text-gray-400 max-w-md leading-normal">
                持续听题、自动分段转写；截图直接解题。默认口语短答，个人经历以资料为依据。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Verified Citations & Evidence Preview (P1-05) */}
      {showRightCol ? (
        <div className="w-80 border-l border-gray-800 flex flex-col justify-between bg-gray-950/60 p-4 shrink-0 transition-all">
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <span className="text-xs font-semibold text-gray-300">引用资料与来源</span>
              <button
                onClick={() => setShowRightCol(false)}
                className="text-gray-400 hover:text-gray-200 p-1 rounded hover:bg-gray-800"
                title="折叠引用栏"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3">
              {currentTurn && currentTurn.citations.length > 0 ? (
                currentTurn.citations.map((cite) => (
                  <div
                    key={cite.id}
                    onClick={() => openCitationInspector(cite)}
                    className="p-3 bg-gray-900 border border-gray-800 hover:border-emerald-500/50 rounded-lg cursor-pointer transition-all space-y-2 group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold">
                          [资料{cite.citationIndex}]
                        </span>
                        {cite.isVerified ? (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-900/40 text-emerald-300 border border-emerald-700/50 flex items-center space-x-0.5">
                            <CheckCircle2 size={10} />
                            <span>已实际引用</span>
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-800 text-gray-400 border border-gray-700">
                            检索候选
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-500">
                        {cite.page ? `第 ${cite.page} 页` : '章节'}
                      </span>
                    </div>

                    <div className="text-xs font-medium text-gray-200 flex items-center space-x-1">
                      <FileText size={13} className="text-gray-400 shrink-0" />
                      <span className="truncate">{cite.fileName}</span>
                    </div>

                    <div className="text-[11px] text-gray-400 bg-gray-950/80 p-2 rounded border border-gray-800/80 line-clamp-3 leading-relaxed">
                      {cite.snippet}
                    </div>

                    <div className="text-[10px] text-emerald-400 flex items-center space-x-1 group-hover:underline">
                      <span>查看完整片段与上下文</span>
                      <ExternalLink size={10} />
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-gray-500 bg-gray-900/40 rounded-lg border border-dashed border-gray-800 space-y-2">
                  <Info size={18} className="mx-auto text-gray-600" />
                  <div>当前回答未引用任何资料，或未命中相关段落</div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowRightCol(true)}
          className="w-7 border-l border-gray-800 bg-gray-950 flex flex-col items-center py-4 text-gray-400 hover:text-gray-200"
          title="展开引用栏"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      {/* Citation Deep Inspector Modal (P1-05) */}
      {selectedCitation && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded text-xs bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold">
                  [资料{selectedCitation.citationIndex}]
                </span>
                <span className="text-xs text-gray-200 font-medium">{selectedCitation.fileName}</span>
                {selectedCitation.isVerified && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/60 text-emerald-300 border border-emerald-700">
                    回答已引用
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedCitation(null)}
                className="text-gray-400 hover:text-gray-200 text-xs px-2 py-1 rounded hover:bg-gray-800"
              >
                关闭
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-gray-400">
              <div>
                <strong>定位路径：</strong> {selectedCitation.sectionPath || '正文'} {selectedCitation.page && `(第 ${selectedCitation.page} 页)`}
              </div>

              {/* View mode toggle tabs */}
              <div className="flex items-center space-x-1 bg-gray-950 p-0.5 rounded border border-gray-800">
                <button
                  onClick={() => setInspectorMode('snippet')}
                  className={`px-2 py-1 rounded text-[11px] transition-colors ${
                    inspectorMode === 'snippet' ? 'bg-gray-800 text-gray-100 font-medium' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  命中分片
                </button>
                <button
                  onClick={loadNeighbors}
                  className={`px-2 py-1 rounded text-[11px] transition-colors flex items-center space-x-1 ${
                    inspectorMode === 'neighbors' ? 'bg-gray-800 text-gray-100 font-medium' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Layers size={11} />
                  <span>邻近上下文</span>
                </button>
                <button
                  onClick={loadFullDoc}
                  className={`px-2 py-1 rounded text-[11px] transition-colors flex items-center space-x-1 ${
                    inspectorMode === 'full' ? 'bg-gray-800 text-gray-100 font-medium' : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <FileSearch size={11} />
                  <span>整篇原文</span>
                </button>
              </div>
            </div>

            {/* Inspector Content Body */}
            <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 text-xs text-gray-200 leading-relaxed max-h-96 overflow-y-auto whitespace-pre-wrap select-text space-y-3 font-mono">
              {inspectorMode === 'snippet' && (
                <div>{selectedCitation.fullText || selectedCitation.snippet}</div>
              )}

              {inspectorMode === 'neighbors' && (
                neighborChunks ? (
                  <div className="space-y-4">
                    {neighborChunks.map((c) => (
                      <div
                        key={c.id}
                        className={`p-2.5 rounded border ${
                          c.id === selectedCitation.chunkId
                            ? 'bg-emerald-950/30 border-emerald-700/60 text-emerald-200'
                            : 'bg-gray-900 border-gray-800 text-gray-400'
                        }`}
                      >
                        <div className="text-[10px] text-gray-500 mb-1">
                          分片 #{c.ordinal} · {c.sectionPath} {c.id === selectedCitation.chunkId && '(当前命中)'}
                        </div>
                        <div>{c.text}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-gray-500 py-4 text-center">正在加载相邻段落...</div>
                )
              )}

              {inspectorMode === 'full' && (
                fullDocText !== null ? (
                  <div>{fullDocText}</div>
                ) : (
                  <div className="text-gray-500 py-4 text-center">正在读取文档全文...</div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
