import { AnswerContent } from './AnswerContent';
import React, { useState, useEffect, useRef } from 'react';
import { Pin, PinOff, X, Eye, FileText, MousePointer, Camera, Crop, Loader2 } from 'lucide-react';
import { TurnRecord, CitationSnapshot } from '../../../main/types';

export const FloatingWindowView: React.FC = () => {
  const [currentTurn, setCurrentTurn] = useState<TurnRecord | null>(null);
  const [pinnedTurn, setPinnedTurn] = useState<TurnRecord | null>(null);
  const [opacity, setOpacity] = useState(0.92);
  const [showCitations, setShowCitations] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const [errorMessage, setErrorMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const latestTurnRef = useRef<TurnRecord | null>(null);
  const selectedSessionRef = useRef<string | null>(null);
  const selectionVersionRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const version = selectionVersionRef.current;
    void (window as any).api.getActiveTurn?.().then((turn: TurnRecord | null) => {
      if (!mounted || version !== selectionVersionRef.current || latestTurnRef.current) return;
      latestTurnRef.current = turn;
      selectedSessionRef.current = turn?.sessionId ?? null;
      setCurrentTurn(turn);
    });
    const show = (turn: TurnRecord | null) => {
      latestTurnRef.current = turn;
      setCurrentTurn(turn);
    };
    const unsubSession = (window as any).api.onChatSessionSelected?.((payload: any) => {
      selectionVersionRef.current++;
      selectedSessionRef.current = payload.sessionId;
      show(payload.turn ?? null);
    });
    const unsubStart = (window as any).api.onChatStreamStart?.((payload: any) => {
      if (selectedSessionRef.current && selectedSessionRef.current !== payload.sessionId) return;
      selectionVersionRef.current++;
      selectedSessionRef.current = payload.sessionId;
      show({ id: payload.turnId, sessionId: payload.sessionId, question: payload.question,
        role: 'assistant', answer: '', status: 'streaming', citations: [], createdAt: payload.createdAt });
    });
    const matches = (payload: any) => {
      const turn = latestTurnRef.current;
      return !!turn && turn.id === payload?.turnId && turn.sessionId === payload?.sessionId &&
        selectedSessionRef.current === payload.sessionId && turn.status === 'streaming';
    };
    const offReset = (window as any).api.onChatReset?.((payload: any) => {if(matches(payload)) show({...latestTurnRef.current!, answer:''});});
    const unsubToken = (window as any).api.onChatStreamToken((payload: any) => {
      if (!matches(payload) || typeof payload.token !== 'string') return;
      show({ ...latestTurnRef.current!, answer: latestTurnRef.current!.answer + payload.token });
    });
    const unsubComplete = (window as any).api.onChatStreamComplete((payload: any) => {
      if (!matches(payload) || payload.turn?.id !== payload.turnId) return;
      show({ ...payload.turn, citations: payload.turn.citations ?? [] });
    });
    const unsubError = (window as any).api.onChatStreamError((payload: any) => {
      if (!matches(payload)) return;
      if(payload.status!=='cancelled') setErrorMessage(payload.error);
      show({ ...latestTurnRef.current!, status: payload.status === 'cancelled' ? 'cancelled' : 'error' });
    });
    void (window as any).api.getClickThrough?.().then((enabled: boolean) => {
      if (mounted) setIsClickThrough(enabled);
    });
    const unsubClickThrough = (window as any).api.onClickThroughChanged?.((enabled: boolean) => {
      setIsClickThrough(enabled);
    });
    return () => { mounted = false; unsubSession?.(); unsubStart?.(); offReset?.(); unsubToken(); unsubComplete(); unsubError(); unsubClickThrough?.(); };
  }, []);

  const handleToggleClickThrough = async () => {
    const next = await (window as any).api.toggleClickThrough?.();
    setIsClickThrough(next);
  };

  const handleCaptureScreen = async (mode: 'interactive' | 'fullscreen' = 'interactive') => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      await (window as any).api.captureAndAsk(mode, selectedSessionRef.current || undefined);
    } catch (err: any) {
      setErrorMessage(err.message || '截图失败');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleTogglePin = () => {
    if (isPinned) {
      setIsPinned(false);
      setPinnedTurn(null);
    } else {
      setIsPinned(true);
      setPinnedTurn(latestTurnRef.current);
    }
  };

  const handleOpacityChange = (val: number) => {
    setOpacity(val);
    (window as any).api.setFloatingOpacity(val);
  };

  const handleClose = () => {
    (window as any).api.toggleFloatingWindow();
  };

  const displayedTurn = isPinned ? pinnedTurn : currentTurn;

  return (
    <div
      style={{ opacity }}
      className="h-screen w-screen flex flex-col bg-gray-950/95 border border-emerald-500/40 rounded-xl overflow-hidden shadow-2xl text-gray-100 select-none backdrop-blur-md"
    >
      {/* Draggable Titlebar */}
      <div className="titlebar-drag h-8 bg-gray-900/90 border-b border-gray-800/80 px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-semibold text-gray-200">傻逼面试 · 悬浮辅助</span>
          {isPinned && (
            <span className="text-[9px] bg-amber-950 border border-amber-800 text-amber-400 px-1 rounded">
              已固定
            </span>
          )}
        </div>

        <div className="no-drag flex items-center space-x-2">
          {/* Quick Screen Capture */}
          <button
            onClick={() => handleCaptureScreen('interactive')}
            disabled={isCapturing}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-emerald-400 transition-colors"
            title="选区截屏识题 (快捷键: Cmd+Alt+X)"
          >
            {isCapturing ? <Loader2 size={13} className="animate-spin text-emerald-400" /> : <Crop size={13} />}
          </button>

          {/* Click-through toggle */}
          <button
            onClick={handleToggleClickThrough}
            className={`p-1 rounded hover:bg-gray-800 text-xs transition-colors ${
              isClickThrough ? 'text-emerald-400 bg-emerald-950/60 border border-emerald-700/60' : 'text-gray-400 hover:text-gray-200'
            }`}
            title={isClickThrough ? '退出鼠标穿透 (快捷键: Cmd+Shift+P)' : '开启鼠标穿透 (点击穿透至后方应用，快捷键: Cmd+Shift+P)'}
          >
            <MousePointer size={13} />
          </button>

          {/* Opacity Slider */}
          <div className="flex items-center space-x-1" title="调节透明度">
            <Eye size={12} className="text-gray-400" />
            <input
              type="range"
              min="0.3"
              max="1.0"
              step="0.05"
              value={opacity}
              onChange={e => handleOpacityChange(parseFloat(e.target.value))}
              className="w-14 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
          </div>

          {/* Pin Button */}
          <button
            onClick={handleTogglePin}
            className={`p-1 rounded hover:bg-gray-800 text-xs transition-colors ${
              isPinned ? 'text-amber-400' : 'text-gray-400 hover:text-gray-200'
            }`}
            title={isPinned ? '取消固定回答' : '固定当前回答'}
          >
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>

          {/* Close Floating Window */}
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-red-900/40 text-gray-400 hover:text-red-400 transition-colors"
            title="关闭悬浮窗"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Click-through indicator banner */}
      {isClickThrough && (
        <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-2.5 py-1 text-[10px] text-emerald-300 flex items-center justify-between shrink-0">
          <span>🎯 穿透模式已生效：鼠标点击将穿透至后方应用</span>
          <span className="font-mono text-[9px] bg-emerald-900/60 px-1 rounded">Cmd+Shift+P 退出</span>
        </div>
      )}

      {errorMessage && <div className="text-xs text-red-300 px-3 py-1" role="alert">{errorMessage}</div>}
      {/* Body: Question & Answer */}
      <div className="flex-1 flex flex-col p-3 overflow-hidden">
        {displayedTurn ? (
          <>
            <div className="pb-2 border-b border-gray-800/70 shrink-0">
              <div className="text-[11px] font-medium text-emerald-400 truncate">
                {displayedTurn.question}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto py-2 pr-1 select-text">
              <AnswerContent text={displayedTurn.answer || '等待生成...'}/>
            </div>

            {displayedTurn.citationWarning && (
              <div className="my-1.5 p-1.5 bg-amber-950/80 border border-amber-600/70 rounded text-[10px] text-amber-200 shrink-0">
                ⚠️ {displayedTurn.citationWarning}
              </div>
            )}

            {/* Citations Expand Bar */}
            {(displayedTurn.citations || []).length > 0 && (
              <div className="pt-2 border-t border-gray-800/70 flex items-center justify-between shrink-0">
                <button
                  onClick={() => setShowCitations(!showCitations)}
                  className="text-[10px] text-emerald-400 hover:underline flex items-center space-x-1"
                >
                  <FileText size={11} />
                  <span>{showCitations ? '隐藏引用' : `展开 ${(displayedTurn.citations || []).length} 处引用资料`}</span>
                </button>
              </div>
            )}

            {showCitations && (displayedTurn.citations || []).length > 0 && (
              <div className="max-h-24 overflow-y-auto mt-1 p-2 bg-gray-900 rounded border border-gray-800 text-[10px] text-gray-300 space-y-1">
                {(displayedTurn.citations || []).map(c => (
                  <div key={c.id} className="truncate">
                    <strong className="text-emerald-400">[资料{c.citationIndex}]</strong> {c.fileName} ({c.sectionPath}): {c.snippet}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
            暂无回答，在主窗口输入问题开始辅导
          </div>
        )}
      </div>
    </div>
  );
};
