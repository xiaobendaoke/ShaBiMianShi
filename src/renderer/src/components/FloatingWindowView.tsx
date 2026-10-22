import { AnswerContent } from './AnswerContent';
import React, { useState, useEffect, useRef } from 'react';
import { Pin, PinOff, X, Eye, FileText, MousePointer, Camera, Crop, Loader2 } from 'lucide-react';
import { TurnRecord, CitationSnapshot } from '../../../main/types';
import { Badge, Kbd, cx } from './ui';

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
  const hudButton = (active = false) => cx('h-6 w-6 inline-flex items-center justify-center rounded-md transition-colors', active ? 'bg-accent-soft text-accent-text' : 'text-label-2 hover:bg-fill hover:text-label');

  return (
    <div
      style={{ opacity }}
      className="h-screen w-screen flex flex-col bg-elevated/85 backdrop-blur-2xl border border-separator rounded-2xl overflow-hidden text-label select-none"
    >
      {/* Draggable Titlebar */}
      <div className="titlebar-drag h-9 px-3 flex items-center justify-between shrink-0 border-b border-separator">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cx('h-2 w-2 rounded-full shrink-0', displayedTurn?.status === 'streaming' ? 'bg-accent animate-pulse' : 'bg-success')} />
          <span className="text-[12px] font-semibold text-label truncate">傻逼面试 · 悬浮辅助</span>
          {isPinned && <Badge tone="warning">已固定</Badge>}
        </div>

        <div className="no-drag flex items-center gap-0.5">
          <button onClick={() => handleCaptureScreen('interactive')} disabled={isCapturing} className={hudButton()} title="选区截屏识题 (快捷键: Cmd+Alt+X)">
            {isCapturing ? <Loader2 size={13} className="animate-spin text-accent" /> : <Crop size={13} />}
          </button>
          <button onClick={handleToggleClickThrough} className={hudButton(isClickThrough)} title={isClickThrough ? '退出鼠标穿透 (快捷键: Cmd+Shift+P)' : '开启鼠标穿透 (点击穿透至后方应用，快捷键: Cmd+Shift+P)'}>
            <MousePointer size={13} />
          </button>
          <div className="flex items-center gap-1 px-1" title="调节透明度">
            <Eye size={12} className="text-label-3" />
            <input type="range" min="0.3" max="1.0" step="0.05" value={opacity} onChange={e => handleOpacityChange(parseFloat(e.target.value))} className="w-14 h-1 accent-[var(--accent)]" />
          </div>
          <button onClick={handleTogglePin} className={hudButton(isPinned)} title={isPinned ? '取消固定回答' : '固定当前回答'}>
            {isPinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button onClick={handleClose} className={cx(hudButton(), 'hover:text-danger')} title="关闭悬浮窗">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Click-through indicator banner */}
      {isClickThrough && (
        <div className="bg-accent-soft px-3 py-1 text-[11px] text-accent-text flex items-center justify-between shrink-0">
          <span>穿透模式已生效：鼠标点击将穿透至后方应用</span>
          <Kbd>⇧⌘P 退出</Kbd>
        </div>
      )}

      {errorMessage && <div className="text-[12px] text-danger px-3 py-1.5 bg-danger-soft" role="alert">{errorMessage}</div>}
      {/* Body: Question & Answer */}
      <div className="flex-1 flex flex-col px-4 pt-3 pb-3 overflow-hidden">
        {displayedTurn ? (
          <>
            <div className="text-[13px] font-semibold text-label leading-snug line-clamp-2 shrink-0">
              {displayedTurn.question}
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto pt-2 pr-1 select-text">
              <AnswerContent text={displayedTurn.answer || '等待生成...'}/>
            </div>

            {displayedTurn.citationWarning && (
              <div className="mt-2 rounded-lg bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning shrink-0">
                {displayedTurn.citationWarning}
              </div>
            )}

            {/* Citations Expand Bar */}
            {(displayedTurn.citations || []).length > 0 && (
              <div className="pt-2 mt-2 border-t border-separator flex items-center shrink-0">
                <button onClick={() => setShowCitations(!showCitations)} className="text-[11px] text-accent-text hover:underline flex items-center gap-1">
                  <FileText size={11} />
                  <span>{showCitations ? '隐藏引用' : `展开 ${(displayedTurn.citations || []).length} 处引用资料`}</span>
                </button>
              </div>
            )}

            {showCitations && (displayedTurn.citations || []).length > 0 && (
              <div className="max-h-24 overflow-y-auto mt-1.5 rounded-lg bg-fill px-2.5 py-2 text-[11px] text-label-2 space-y-1">
                {(displayedTurn.citations || []).map(c => (
                  <div key={c.id} className="truncate">
                    <strong className="text-accent-text font-medium">资料{c.citationIndex}</strong> {c.fileName} ({c.sectionPath}): {c.snippet}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] text-label-3">
            暂无回答，在主窗口输入问题开始辅导
          </div>
        )}
      </div>
    </div>
  );
};
