import { AnswerContent } from './AnswerContent';
import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowUp,
  Square,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
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
  AlertCircle,
  PanelLeft,
  PanelRight,
  RotateCcw,
  ImagePlus,
  Captions,
  Brain
} from 'lucide-react';
import { SessionRecord, TurnRecord, CitationSnapshot, Library, ChunkRecord, ImageAttachment, AnswerOptions } from '../../../main/types';

import {MemoryPanel} from './MemoryPanel';
import { AudioPanel } from './AudioPanel';
import { Badge, Kbd, Notice, Segmented, button, cx, selectField, textArea } from './ui';
import { TurnNavigation } from '../turnNavigation';


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
  // 历史记录栏默认展开（旧版布局）；顶部横向胶囊条已移除
  const [showLeftCol, setShowLeftCol] = useState(true);
  const [showRightCol, setShowRightCol] = useState(false);
  // 停留模式：false 表示正在浏览历史题，新题不再抢焦点
  const [followingLatest, setFollowingLatest] = useState(true);

  const [isCapturing, setIsCapturing] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [deepThinking, setDeepThinking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [shortcutFailures, setShortcutFailures] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImageAttachment | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const commandRef = useRef<(command: string) => void>(() => {});
  const answerScrollRef = useRef<HTMLDivElement>(null);
  const navigation = useRef(new TurnNavigation());

  const activeTurnRef = useRef<{ sessionId: string; turnId: string } | null>(null);
  const stoppedTurnsRef = useRef(new Set<string>());
  const currentSessionRef = useRef(currentSession?.id);
  currentSessionRef.current = currentSession?.id;

  const latestTurn = (rows: TurnRecord[]) => rows.reduce<TurnRecord | null>(
    (latest, turn) => (!latest || turn.createdAt >= latest.createdAt ? turn : latest), null);
  // 点选历史题目后停留：后续新题开始生成也不再抢走当前显示。
  const selectHistoryTurn = (turn: TurnRecord) => {
    navigation.current.pause(turns);
    setFollowingLatest(false);
    setCurrentTurn(turn);
  };
  const resumeFollowing = () => {
    navigation.current.reset();
    setFollowingLatest(true);
    setCurrentTurn(latestTurn(turns));
  };
  const unreadCount = followingLatest ? 0 : navigation.current.unread(turns);

  useEffect(() => {
    let mounted = true;
    const sessionId = currentSession?.id;
    navigation.current.reset(); setFollowingLatest(true);
    activeTurnRef.current = null;
    setIsGenerating(false); setTurns([]); setCurrentTurn(null); setImages([]); setPreview(null); setErrorMessage(''); setQuestionInput(''); setSelectedCitation(null); setNeighborChunks(null); setFullDocText(null);
    if (sessionId) void (async () => {
      try {
        await (window as any).api.selectSession?.(sessionId);
        const records: TurnRecord[] = await (window as any).api.getTurns(sessionId);
        const snapshot: TurnRecord | null = await (window as any).api.getActiveTurn?.() ?? null;
        if (!mounted || activeTurnRef.current || currentSessionRef.current !== sessionId) return;
        const latest = snapshot?.sessionId === sessionId ? snapshot : records.at(-1) ?? null;
        setTurns(records); setCurrentTurn(previous => navigation.current.following ? latest : previous);
        if (latest?.status === 'streaming' && !stoppedTurnsRef.current.has(latest.id)) {
          activeTurnRef.current = { sessionId, turnId: latest.id };
          setIsGenerating(true);
        }
      } catch (error) { console.warn('无法读取会话', error); }
    })();
    return () => { mounted = false; };
  }, [currentSession?.id]);

  useEffect(() => { setActiveLibraryIds(currentSession?.libraryIds ?? []); }, [currentSession?.libraryIds]);

  // Each newly selected question starts reading from the top.
  useEffect(() => { answerScrollRef.current?.scrollTo?.({top: 0}); }, [currentTurn?.id]);

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
      setTurns(rows => [...rows.filter(t => t.id !== turn.id), turn].sort((a, b) => a.createdAt - b.createdAt));
      setCurrentTurn(previous => navigation.current.shouldDisplay(previous, turn) ? turn : previous);
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
    navigation.current.reset(); setFollowingLatest(true);
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
    if (command === 'previous' && index > 0) selectHistoryTurn(turns[index-1]);
    if (command === 'next' && index < turns.length-1) selectHistoryTurn(turns[index+1]);
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

  const statusText = (turn: TurnRecord) => turn.status === 'streaming'
    ? '正在生成回答…'
    : turn.status === 'cancelled'
    ? '回答已取消'
    : turn.status === 'queued' ? '等待上一题完成' : turn.status === 'error' ? '生成失败' : '回答完成';
  const statusTone = (turn: TurnRecord) => turn.status === 'streaming' ? 'accent' as const : turn.status === 'error' ? 'danger' as const : turn.status === 'queued' ? 'warning' as const : turn.status === 'cancelled' ? 'neutral' as const : 'success' as const;
  const turnIndex = turns.findIndex(t => t.id === currentTurn?.id);
  const queuedCount = turns.filter(t => t.status === 'queued').length;
  const selectedLibraries = libraries.filter(lib => activeLibraryIds.includes(lib.id));
  const canSend = !!currentSession && (!!questionInput.trim() || !!images.length);

  return (
    <div className="flex-1 flex min-w-0 overflow-hidden aurora">
      {/* Question list for this interview */}
      {showLeftCol && (
        <aside className="w-[264px] shrink-0 border-r border-separator flex flex-col min-h-0 glass">
          <div className="titlebar-drag h-[52px] shrink-0 flex items-center justify-between pl-4 pr-2 border-b border-separator">
            <div className="text-[13px] font-semibold text-label">本场问答记录 <span className="font-normal text-label-3">{turns.length}</span></div>
            <button onClick={() => setShowLeftCol(false)} className={button.icon} title="折叠记录栏"><PanelLeft size={16} strokeWidth={1.75} /></button>
          </div>
          {!followingLatest && (
            <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-separator text-[11px] text-warning" role="status">
              <span className="truncate">{unreadCount > 0 ? `有 ${unreadCount} 条新问题` : '已暂停自动跟随'}</span>
              <button onClick={resumeFollowing} className={cx(button.link, 'h-6 text-[11px] text-warning hover:bg-warning-soft')}>回到最新</button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-2 space-y-px">
            {turns.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-label-3">暂无问答记录，输入问题或点击录音开始</p>
            ) : turns.map((turn, i) => {
              const active = currentTurn?.id === turn.id;
              return (
                <button key={turn.id} onClick={() => selectHistoryTurn(turn)} aria-current={active ? 'true' : undefined}
                  className={cx('w-full text-left rounded-lg px-2.5 py-2 transition-colors', active ? 'bg-accent-soft' : 'hover:bg-fill')}>
                  <div className={cx('text-[13px] leading-snug line-clamp-2', active ? 'text-label font-medium' : 'text-label')}>
                    <span className="text-label-3 tabular-nums mr-1">{i + 1}</span>{turn.topic || turn.question}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-label-3">
                    {turn.status === 'streaming' ? <span className="inline-flex items-center gap-1 text-accent-text"><span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />生成中</span>
                      : turn.status === 'queued' ? <span className="text-warning">排队中</span>
                      : turn.status === 'error' ? <span className="text-danger">失败</span>
                      : <span className="tabular-nums">{new Date(turn.createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</span>}
                    {turn.citations.length > 0 && <span>· {turn.citations.filter(c => c.isVerified).length || turn.citations.length} 处参考资料</span>}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Foldable Resume Facts & Session Memory */}
          <details className="group border-t border-separator">
            <summary className="flex items-center justify-between px-4 h-10 text-[12px] font-medium text-label-2 hover:text-label">
              <span className="flex items-center gap-2"><Brain size={14} strokeWidth={1.75} />简历事实与会话记忆</span>
              <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-3 pb-3 space-y-2 max-h-[45vh] overflow-y-auto">
              <MemoryPanel sessionId={currentSession?.id} />
              <textarea
                className={cx(textArea, 'text-[12px]')}
                placeholder="填写本人负责的项目、职责、可核实结果"
                defaultValue={currentSession?.projectFacts || ''}
                key={`${currentSession?.id}-facts`}
                rows={3}
                onBlur={e => saveSessionFields({ projectFacts: e.target.value })}
              />
              <textarea
                className={cx(textArea, 'text-[12px]')}
                placeholder="目标职位 / JD"
                defaultValue={currentSession?.jobDescription || ''}
                key={`${currentSession?.id}-jd`}
                rows={3}
                onBlur={e => saveSessionFields({ jobDescription: e.target.value })}
              />
            </div>
          </details>
        </aside>
      )}

      {/* Main column */}
      <div className="@container flex-1 min-w-0 flex flex-col">
        <header className="titlebar-drag h-[52px] shrink-0 flex items-center gap-2 px-3">
          {!showLeftCol && <button onClick={() => setShowLeftCol(true)} className={button.icon} title="展开问题栏"><PanelLeft size={16} strokeWidth={1.75} /></button>}
          <div className="min-w-[72px] flex-1 pl-1">
            <div className="truncate text-[13px] font-semibold text-label">{currentSession?.title || '面试辅助'}</div>
          </div>

          {/* Knowledge base scope */}
          <div className="relative">
            <button onClick={() => setScopeOpen(!scopeOpen)} className={cx(button.plain, 'h-7 text-[12px]', activeLibraryIds.length === 0 && 'text-warning')} title="选择本场检索的知识库">
              <BookOpen size={14} strokeWidth={1.75} />
              <span className="max-w-[180px] truncate @max-[620px]:hidden">
                {libraries.length === 0 ? '暂无知识库' : activeLibraryIds.length === 0 ? '未选知识库' : selectedLibraries.length === 1 ? selectedLibraries[0].name : `${selectedLibraries.length} 个知识库`}
              </span>
              <ChevronDown size={12} />
            </button>
            {scopeOpen && <>
              <button aria-label="关闭知识库选择" className="fixed inset-0 z-40 cursor-default" onClick={() => setScopeOpen(false)} />
              <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl bg-elevated shadow-pop border border-separator p-1.5 animate-fade-up">
                <div className="px-2.5 pt-1.5 pb-2 text-[11px] font-semibold text-label-3">知识库：本场回答检索范围</div>
                {libraries.length === 0 && <p className="px-2.5 pb-2 text-[12px] text-label-2">暂无知识库，请先在“知识库”中导入资料。</p>}
                {libraries.map(lib => {
                  const isSelected = activeLibraryIds.includes(lib.id);
                  return (
                    <button key={lib.id} onClick={() => toggleLibraryScope(lib.id)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 h-9 text-left hover:bg-fill">
                      <span className={cx('h-4 w-4 shrink-0 rounded-[5px] flex items-center justify-center', isSelected ? 'bg-accent text-white' : 'border border-label-3')}>{isSelected && <Check size={11} strokeWidth={3} />}</span>
                      <span className="flex-1 truncate text-[13px] text-label">{lib.name}</span>
                      <span className="text-[11px] text-label-3">{lib.docCount}篇</span>
                    </button>
                  );
                })}
                {libraries.length > 0 && activeLibraryIds.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-warning">未选知识库：项目类问题将无法引用资料</p>}
              </div>
            </>}
          </div>

          {turns.length > 0 && (
            <div className="flex items-center text-[12px] text-label-2">
              <button onClick={() => commandRef.current('previous')} disabled={turnIndex <= 0} className={button.icon} title="上一题 (Cmd+Alt+←)"><ChevronLeft size={16} /></button>
              <span className="tabular-nums min-w-[3.2em] text-center">{turnIndex + 1} / {turns.length}</span>
              <button onClick={() => commandRef.current('next')} disabled={turnIndex >= turns.length - 1} className={button.icon} title="下一题 (Cmd+Alt+→)"><ChevronRight size={16} /></button>
            </div>
          )}
          <button onClick={() => setShowRightCol(!showRightCol)} className={cx(button.icon, showRightCol && 'bg-fill text-label')} title={showRightCol ? '折叠引用栏' : '展开引用栏'}>
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
        </header>

        {/* Answer canvas */}
        <div ref={answerScrollRef} className="flex-1 overflow-y-auto">
          {currentTurn ? (
            <article key={currentTurn.id} className="max-w-[820px] mx-auto px-6 @min-[680px]:px-10 pt-8 pb-10 animate-fade-up">
              <div className="flex items-center gap-2 text-[12px] text-label-3">
                <Badge tone={statusTone(currentTurn)}>
                  {currentTurn.status === 'streaming' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
                  {statusText(currentTurn)}
                </Badge>
                <span className="tabular-nums">当前问题 · {new Date(currentTurn.createdAt).toLocaleTimeString()}</span>
              </div>
              <h1 className="mt-3 text-[32px] @max-[620px]:text-[26px] leading-[1.18] font-bold tracking-[-0.03em] text-label select-text">{currentTurn.topic || currentTurn.question}</h1>

              {/* Answer actions */}
              <div className="mt-5 flex flex-wrap items-center gap-1.5">
                {isGenerating ? (
                  <button onClick={handleStop} className={cx(button.danger, 'h-7 rounded-full text-[12px]')}>
                    <Square size={11} fill="currentColor" />
                    <span>停止回答</span>
                  </button>
                ) : (
                  <>
                    <button onClick={handleCopy} className={button.chip}>
                      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                      <span>{copied ? '已复制' : '复制回答'}</span>
                    </button>
                    <button onClick={() => handleSend(currentTurn.question, currentTurn.options)} className={button.chip}>
                      <RotateCcw size={13} />
                      <span>重新回答</span>
                    </button>
                  </>
                )}
                <span className="mx-1 h-4 w-px bg-separator" />
                <button className={button.chip} disabled={isGenerating} onClick={()=>void handleSend(`请将下面的回答压缩成一句话。问题：${currentTurn.question}。回答：${currentTurn.answer}`, {action:'shorten'})}>再短一点</button>
                <button className={button.chip} disabled={isGenerating} onClick={()=>void handleSend(`请展开解释这道题。问题：${currentTurn.question}。已有回答：${currentTurn.answer}`, {action:'explain'})}>展开解释</button>
                <button className={button.chip} disabled={isGenerating} onClick={()=>void handleSend(questionInput || '请结合上一版代码和本次截图或报错调试，给出完整修正版。', {action:'debug', images:images.length?images:currentTurn.options?.images, language:currentSession?.language || 'C17', deepThinking})}>调试提交</button>
                <button className={button.chip} disabled={!images.length || isGenerating} onClick={()=>void handleSend('只提取图片中的完整题目。', {action:'extract', images})}>只提取题目</button>
                <button className={button.chip} onClick={()=>void (window as any).api.clearAttachments(currentSession?.id).then(()=>{setPreview(null);setImages([]);return (window as any).api.getTurns(currentSession?.id);}).then(setTurns).catch((e:any)=>setErrorMessage(e.message))}>清理本场截图</button>
              </div>

              {/* Diagnostics */}
              {(currentTurn.timings || currentTurn.retrieval || !!currentTurn.options?.images?.length) && (
                <div className="mt-4 space-y-1.5 text-[12px] text-label-2">
                  {!!currentTurn.options?.images?.length && <details className="group"><summary className="inline-flex items-center gap-1 hover:text-label"><ChevronRight size={12} className="transition-transform group-open:rotate-90" />本题截图（{currentTurn.options.images.length}张） · 语言按题目要求优先，否则 {currentTurn.options.language || currentSession?.language || 'C17'}</summary><div className="mt-2 flex gap-2 overflow-x-auto">{currentTurn.options.images.map(image=><img key={image.id} className="max-h-48 rounded-lg border border-separator" src={`data:${image.mimeType};base64,${image.base64}`} alt="本题截图"/>)}</div></details>}
                  {currentTurn.retrieval&&<details className="group"><summary className="inline-flex items-center gap-1 hover:text-label"><ChevronRight size={12} className="transition-transform group-open:rotate-90" />检索依据 · {currentTurn.retrieval.name||'未限定项目'} · {currentTurn.retrieval.items.length}段</summary><div className="mt-2 rounded-lg bg-surface p-3 space-y-1.5"><p>{currentTurn.retrieval.reason}</p><ul className="list-disc pl-4 space-y-0.5">{currentTurn.retrieval.items.map(item=><li key={item.chunkId}>{item.fileName} / {item.sectionPath}（{item.chars}字）</li>)}</ul>{currentTurn.retrieval.omitted.map((text,i)=><p className="text-warning" key={i}>{text}</p>)}</div></details>}
                  {currentTurn.timings && <p className="text-[11px] text-label-3 tabular-nums">首字 {currentTurn.timings.firstTokenMs ?? '等待'}ms · 总耗时 {currentTurn.timings.totalMs ?? '进行中'}ms · 排队 {currentTurn.timings.queuedMs ?? 0}ms{currentTurn.timings.speechToSubmitMs !== undefined && <> · 说完至提交 {currentTurn.timings.speechToSubmitMs}ms</>}{currentTurn.timings.retrievalMs !== undefined && <> · 上下文准备 {currentTurn.timings.retrievalMs}ms</>}{currentTurn.timings.responseMs !== undefined && <> · 接口响应头 {currentTurn.timings.responseMs}ms · {currentTurn.timings.streaming?'流式返回':'整段返回'} · 请求{currentTurn.timings.attempts}次</>}{currentTurn.timings.speechToFirstTokenMs !== undefined && <> · 说完至首字 {currentTurn.timings.speechToFirstTokenMs}ms</>}</p>}
                </div>
              )}

              {/* Answer Stream Body */}
              <div className="mt-6 rounded-[28px]"><div className="rounded-[28px] bg-surface shadow-card px-8 py-7 @max-[620px]:px-5 select-text">
                {currentTurn.error && <div className="mb-4"><Notice tone="danger">{currentTurn.error}</Notice></div>}
                {currentTurn.citationWarning && <div className="mb-4"><Notice tone="warning">{currentTurn.citationWarning}</Notice></div>}
                {currentTurn.options?.action === 'explain' ? <details className="group" open={currentTurn.status === 'streaming' || undefined}><summary className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-text"><ChevronRight size={14} className="transition-transform group-open:rotate-90" />解析（点击展开）</summary><div className="py-3"><AnswerContent text={currentTurn.answer || '正在生成解释…'}/></div></details> : (
                  <div className="min-w-0">
                    {currentTurn.answer ? <AnswerContent text={currentTurn.answer}/> : (isGenerating && (
                      <div className="flex items-center gap-2.5 text-[13px] text-label-2 py-2">
                        <Loader2 size={15} className="animate-spin text-accent" />
                        <span>正在生成回答；若服务不支持流式输出，请等待完整结果…</span>
                      </div>
                    ))}
                  </div>
                )}
              </div></div>
            </article>
          ) : (
            <div className="min-h-full flex flex-col items-center justify-center px-8 py-10 text-center animate-fade-up">
              <div className="text-[13px] font-semibold tracking-wide text-intelligence">准备就绪，随时提问</div>
              <h2 className="mt-3 text-[52px] @max-[640px]:text-[38px] leading-[1.06] font-bold tracking-[-0.04em] text-label">
                面试官一开口，<br /><span className="text-intelligence">答案就在这里。</span>
              </h2>
              <p className="mt-5 text-[16px] leading-relaxed text-label-2 max-w-[34em]">
                持续听题、自动分段转写；截图直接解题。默认口语短答，个人经历以资料为依据。
              </p>
              <div className="mt-10 grid grid-cols-2 @min-[900px]:grid-cols-4 gap-3 w-full max-w-[880px] text-left">
                {[
                  {icon: Mic, title: '语音听题', desc: '系统声音或麦克风，停顿后自动提交', keys: '⇧⌘G', tile: 'from-[#40c8ff] to-[#0a84ff]'},
                  {icon: Crop, title: '选区解题', desc: '框选题目，多张截图一起作答', keys: '⌥⌘X', tile: 'from-[#da8fff] to-[#bf5af2]'},
                  {icon: BookOpen, title: '资料问答', desc: '结合简历与项目文档，引用可追溯', keys: '知识库', tile: 'from-[#ffb340] to-[#ff7a00]'},
                  {icon: Layers, title: '悬浮窗', desc: '独立显示答案，可鼠标穿透', keys: '⇧⌘Space', tile: 'from-[#5ee0a0] to-[#28b463]'}
                ].map(tip => (
                  <div key={tip.title} className="rounded-[22px] bg-surface shadow-card p-5 transition-transform hover:-translate-y-0.5">
                    <div className={cx('h-10 w-10 rounded-[12px] bg-gradient-to-br text-white flex items-center justify-center shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]', tip.tile)}>
                      <tip.icon size={20} strokeWidth={2} />
                    </div>
                    <div className="mt-4 text-[15px] font-semibold text-label">{tip.title}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-label-2 min-h-[3em]">{tip.desc}</div>
                    <div className="mt-3"><Kbd>{tip.keys}</Kbd></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="shrink-0 px-4 @min-[680px]:px-6 pb-5 pt-1">
          <div className="max-w-[820px] mx-auto space-y-2">
            {shortcutFailures.length > 0 && <Notice tone="warning">快捷键冲突：{shortcutFailures.join('、')}</Notice>}
            {errorMessage && <Notice tone="danger" action={<button onClick={() => setErrorMessage('')} className={cx(button.icon, 'h-5 w-5')} title="关闭"><X size={12} /></button>}>{errorMessage}</Notice>}
            {queuedCount > 0 && (
              <Notice tone="warning" action={<>
                <button onClick={() => void nextQuestion()} className={cx(button.link, 'h-6 text-[12px] text-warning hover:bg-warning-soft')}>下一题</button>
                <button
                  onClick={() => {
                    void (async () => {
                      for (const t of turns.filter(t => t.status === 'queued')) await (window as any).api.cancelGeneration(t.id, t.sessionId);
                      const rows = await (window as any).api.getTurns(currentSession?.id);
                      setTurns(rows);
                    })();
                  }}
                  className={cx(button.link, 'h-6 text-[12px] text-warning hover:bg-warning-soft')}
                >
                  清空
                </button>
              </>}>待答 {queuedCount} 题</Notice>
            )}

            <AudioPanel sessionId={currentSession?.id} edit={setQuestionInput} />

            <div className="rounded-[24px]"><div className="rounded-[24px] bg-surface shadow-pop">
              {/* Attached Screenshots Preview */}
              {images.length > 0 && (
                <div className="flex items-center gap-2 px-3 pt-3 overflow-x-auto">
                  {images.map(image => (
                    <div key={image.id} className="relative group shrink-0">
                      <img className="h-14 max-w-28 object-cover rounded-lg border border-separator" src={`data:${image.mimeType};base64,${image.base64}`} alt="待提交截图" />
                      <button className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-label text-canvas flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => setImages(rows => rows.filter(i => i.id !== image.id))} title="删除图片">
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    </div>
                  ))}
                  <div className="pl-1 text-[12px] text-label-2 shrink-0">已截取 {images.length} 张图片 · <button onClick={() => void handleSend()} className="text-accent-text font-medium hover:underline">确认提交解题 ↵</button></div>
                </div>
              )}

              <textarea
                value={questionInput}
                onChange={e => setQuestionInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="输入面试官问题，如：订单重复提交如何保证接口幂等性？"
                rows={2}
                className="block w-full bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed text-label placeholder:text-label-3 outline-none resize-none"
              />

              <div className="flex items-center gap-1 px-2 pb-2">
                <button disabled={isCapturing || !currentSession} onClick={() => void handleScreenCapture('interactive')} className={cx(button.plain, 'h-7 px-2 text-[12px]')} title="选区截图解题 (快捷键: Cmd+Alt+X)">
                  {isCapturing ? <Loader2 size={14} className="animate-spin" /> : <Crop size={14} strokeWidth={1.75} />}
                  <span className="@max-[600px]:hidden">选区解题</span>
                </button>
                <button disabled={isCapturing || !currentSession} onClick={() => void handleScreenCapture('fullscreen')} className={cx(button.plain, 'h-7 px-2 text-[12px]')} title="全屏截图解题 (快捷键: Cmd+Shift+S)">
                  <Camera size={14} strokeWidth={1.75} />
                  <span className="@max-[600px]:hidden">全屏</span>
                </button>
                <button disabled={isCapturing || images.length >= 8 || !currentSession} onClick={() => void handleScreenCapture('interactive', true)} className={cx(button.plain, 'h-7 px-2 text-[12px]')} title="追加截图 (最多8张)">
                  <ImagePlus size={14} strokeWidth={1.75} />
                  <span className="@max-[600px]:hidden">+截屏</span>
                </button>

                <span className="mx-1 h-4 w-px bg-separator" />

                <select
                  aria-label="编程语言"
                  className={selectField}
                  value={currentSession?.language || 'C17'}
                  onChange={e => saveSessionFields({ language: e.target.value })}
                  title="编程语言"
                >
                  {['C17', 'C++17', 'Java', 'Python', 'JavaScript', 'TypeScript', 'Go'].map(lang => (
                    <option key={lang} value={lang}>{lang}</option>
                  ))}
                </select>
                <button onClick={() => setDeepThinking(!deepThinking)} aria-pressed={deepThinking} className={cx(button.plain, 'h-7 px-2 text-[12px]', deepThinking && 'bg-accent-soft text-accent-text hover:bg-accent-soft hover:text-accent-text')} title="深入解题：依赖服务商及模型支持">
                  <Brain size={14} strokeWidth={1.75} />
                  <span className="@max-[520px]:hidden">深入解题</span>
                </button>

                <div className="flex-1" />
                {isGenerating ? (
                  <button onClick={handleStop} className="h-8 w-8 rounded-full bg-label text-canvas flex items-center justify-center hover:opacity-85 transition-opacity" title="停止回答">
                    <Square size={11} fill="currentColor" />
                  </button>
                ) : null}
                <button
                  disabled={!canSend}
                  onClick={() => handleSend()}
                  className="h-8 w-8 rounded-full bg-accent text-white flex items-center justify-center hover:bg-accent-hover disabled:bg-fill-strong disabled:text-label-3 transition-colors"
                  title={isGenerating ? '加入待答队列 (Enter)' : '发送问题 (Enter)'}
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div></div>

            {preview && (
              <details className="group text-[12px] text-label-2">
                <summary className="inline-flex items-center gap-1 hover:text-label"><ChevronRight size={12} className="transition-transform group-open:rotate-90" />最近截图 · 点击预览</summary>
                <div className="pt-2 flex items-end gap-3">
                  <img className="max-h-36 rounded-lg border border-separator" alt="最近截图" src={`data:${preview.mimeType};base64,${preview.base64}`} />
                  <button onClick={() => void handleScreenCapture('interactive')} className={cx(button.link, 'text-[12px]')}>重新选区解题</button>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>

      {/* Citations & evidence */}
      {showRightCol && (
        <aside className="w-[320px] shrink-0 border-l border-separator flex flex-col min-h-0 glass">
          <div className="titlebar-drag h-[52px] shrink-0 flex items-center justify-between pl-4 pr-2 border-b border-separator">
            <span className="text-[13px] font-semibold text-label">引用资料与来源</span>
            <button onClick={() => setShowRightCol(false)} className={button.icon} title="折叠引用栏"><PanelRight size={16} strokeWidth={1.75} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {currentTurn && currentTurn.citations.length > 0 ? (
              currentTurn.citations.map((cite) => (
                <button key={cite.id} onClick={() => openCitationInspector(cite)} className="w-full text-left rounded-xl bg-surface hover:bg-fill-strong p-3 space-y-2 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <Badge tone="accent">资料{cite.citationIndex}</Badge>
                    {cite.isVerified ? <Badge tone="success"><CheckCircle2 size={10} />已实际引用</Badge> : <Badge>检索候选</Badge>}
                    <span className="ml-auto text-[11px] text-label-3">{cite.page ? `第 ${cite.page} 页` : '章节'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[13px] font-medium text-label">
                    <FileText size={13} className="text-label-3 shrink-0" />
                    <span className="truncate">{cite.fileName}</span>
                  </div>
                  <div className="text-[12px] leading-relaxed text-label-2 line-clamp-3">{cite.snippet}</div>
                  <div className="text-[11px] text-accent-text">查看完整片段与上下文</div>
                </button>
              ))
            ) : (
              <div className="py-12 px-4 text-center text-[12px] leading-relaxed text-label-3 space-y-2">
                <Info size={20} className="mx-auto" strokeWidth={1.5} />
                <div>当前回答未引用任何资料，或未命中相关段落</div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Citation Deep Inspector Modal (P1-05) */}
      {selectedCitation && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50 flex items-center justify-center p-8" onClick={() => setSelectedCitation(null)}>
          <div className="bg-elevated rounded-2xl max-w-2xl w-full shadow-pop border border-separator overflow-hidden animate-fade-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 h-14 border-b border-separator">
              <Badge tone="accent">资料{selectedCitation.citationIndex}</Badge>
              <span className="text-[13px] font-semibold text-label truncate">{selectedCitation.fileName}</span>
              {selectedCitation.isVerified && <Badge tone="success">回答已引用</Badge>}
              <button onClick={() => setSelectedCitation(null)} className={cx(button.plain, 'ml-auto h-7')}>关闭</button>
            </div>
            <div className="px-5 pt-4 flex items-center justify-between gap-4 text-[12px] text-label-2">
              <div className="truncate"><span className="text-label-3">定位路径：</span>{selectedCitation.sectionPath || '正文'} {selectedCitation.page && `(第 ${selectedCitation.page} 页)`}</div>
              <Segmented
                value={inspectorMode}
                onChange={mode => { if (mode === 'snippet') setInspectorMode('snippet'); else if (mode === 'neighbors') void loadNeighbors(); else void loadFullDoc(); }}
                options={[
                  {id: 'snippet', label: '命中分片'},
                  {id: 'neighbors', label: <span className="inline-flex items-center gap-1"><Layers size={11} />邻近上下文</span>},
                  {id: 'full', label: <span className="inline-flex items-center gap-1"><FileSearch size={11} />整篇原文</span>}
                ]}
              />
            </div>

            {/* Inspector Content Body */}
            <div className="m-5 mt-3 rounded-xl bg-surface p-4 text-[13px] text-label leading-relaxed max-h-[60vh] overflow-y-auto whitespace-pre-wrap select-text space-y-3">
              {inspectorMode === 'snippet' && (
                <div>{selectedCitation.fullText || selectedCitation.snippet}</div>
              )}

              {inspectorMode === 'neighbors' && (
                neighborChunks ? (
                  <div className="space-y-3">
                    {neighborChunks.map((c) => (
                      <div key={c.id} className={cx('rounded-lg p-3', c.id === selectedCitation.chunkId ? 'bg-accent-soft text-label' : 'text-label-2')}>
                        <div className="text-[11px] text-label-3 mb-1">
                          分片 #{c.ordinal} · {c.sectionPath} {c.id === selectedCitation.chunkId && '(当前命中)'}
                        </div>
                        <div>{c.text}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-label-3 py-4 text-center">正在加载相邻段落...</div>
                )
              )}

              {inspectorMode === 'full' && (
                fullDocText !== null ? (
                  <div>{fullDocText}</div>
                ) : (
                  <div className="text-label-3 py-4 text-center">正在读取文档全文...</div>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
