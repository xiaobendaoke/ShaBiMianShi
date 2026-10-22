import React, { useEffect, useRef, useState } from 'react';
import { Mic, Loader2, Pause, Play, Zap, Captions, X, AlertCircle } from 'lucide-react';
import type { TranscriptRecord } from '../../../main/types';
import { AudioCapture } from '../services/audioCapture';
import { Notice, button, cx, selectField } from './ui';

export function AudioPanel({ sessionId, edit }: { sessionId?: string; edit: (text: string) => void }) {
  const api = (window as any).api;
  const [mode, setMode] = useState('system');
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [self, setSelf] = useState(false);
  const [level, setLevel] = useState(0);
  const [pending, setPending] = useState(0);
  const [phase,setPhase] = useState('等待说话');
  const [pendingText,setPendingText] = useState('');
  const [error, setError] = useState('');
  const [records, setRecords] = useState<TranscriptRecord[]>([]);
  const [showDrawer, setShowDrawer] = useState(false);

  const captureId = useRef<string | null>(null);
  const [health, setHealth] = useState<Record<string, { frames: number; rms: number; state: string }>>({});
  const capture = useRef<AudioCapture | null>(null);
  const generation = useRef(0);
  const commands = useRef<(c: string) => void>(() => {});

  const stop = () => {
    generation.current++;
    captureId.current = null;
    capture.current?.stop();
    capture.current = null;
    setRunning(false);
    setStarting(false);
    void api.stopListening().catch((e: any) => setError(e.message));
  };

  const start = async () => {
    if (!sessionId || starting || running) return;
    captureId.current = null;
    setHealth({});
    const epoch = ++generation.current;
    const engine = new AudioCapture();
    capture.current = engine;
    setStarting(true);
    setError('');
    setPaused(false);
    setSelf(false);

    try {
      const id = await api.startListening(sessionId, mode, auto);
      if (generation.current !== epoch) return;
      captureId.current = id;
      const system = mode !== 'microphone' ? await api.startSystemAudio(sessionId, id) : { native: false };
      if (generation.current !== epoch) return;

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          engine.start(
            system.native ? (mode === 'both' ? 'microphone' : 'none') : mode,
            (source, samples) => api.sendAudioFrame(id, source, samples),
            setLevel,
            message => {
              if (generation.current === epoch) {
                setError(message);
                stop();
              }
            },
            sources => setHealth(previous => ({ ...previous, ...sources }))
          ),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(Error('获取音源超时，请检查系统权限或设备；可以重新开始监听')), 30000);
          })
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (generation.current === epoch) setRunning(true);
    } catch (e: any) {
      if (generation.current === epoch) {
        setError(e.message || '无法获取音源，请检查系统录音权限');
        stop();
      }
    } finally {
      if (generation.current === epoch) setStarting(false);
    }
  };

  commands.current = command => {
    if (command === 'listen') {
      if (!running) void start();
      else {
        setPaused(!paused);
        void api.controlListening({ paused: !paused }).catch((e: any) => setError(e.message));
      }
    }
    if (command === 'immediate') void api.answerImmediately().catch((e: any) => setError(e.message));
    if (command === 'self') {
      setSelf(!self);
      void api.controlListening({ selfSpeaking: !self }).catch((e: any) => setError(e.message));
    }
  };

  useEffect(() => {
    let mounted = true;
    setRecords([]);
    if (sessionId) {
      void api
        .getTranscripts(sessionId)
        .then((rows: TranscriptRecord[]) => {
          if (mounted) setRecords(rows);
        })
        .catch((e: any) => {
          if (mounted) setError('无法读取字幕：' + e.message);
        });
    }

    const off = api.onTranscript((r: TranscriptRecord) => {
      if (r.sessionId === sessionId) {
        setRecords(rows => [...rows.filter(x => x.id !== r.id), r].sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence));
      }
    });

    const state = api.onAudioState((p: any) => {
      if (p.sessionId !== sessionId || p.captureId !== captureId.current) return;
      setPending(p.pending || 0); setPhase(p.phase || '等待说话'); setPendingText(p.text || '');
      if (!p.running) {
        generation.current++;
        captureId.current = null;
        capture.current?.stop();
        capture.current = null;
        setStarting(false);
        setRunning(false);
      } else {
        setAuto(p.auto);
        setPaused(p.paused);
        setSelf(p.selfSpeaking);
      }
    });

    const healthOff = api.onAudioHealth((p: any) => {
      if (p.sessionId === sessionId && p.captureId === captureId.current) {
        setHealth(previous => ({ ...previous, [p.source]: { frames: p.frames, rms: p.rms, state: p.state } }));
        setLevel(p.rms);
      }
    });

    const failed = api.onAudioError((p: any) => {
      if (p.sessionId === sessionId && (!p.captureId || p.captureId === captureId.current)) {
        setError(p.error);
      }
    });

    const command = api.onInterviewCommand((c: string) => commands.current(c));

    return () => {
      mounted = false;
      generation.current++;
      captureId.current = null;
      capture.current?.stop();
      capture.current = null;
      void api.stopListening().catch(() => {});
      off();
      state();
      healthOff();
      failed();
      command();
    };
  }, [sessionId]);

  const meter = Math.min(1, level * 5);
  const sourceName = (source: string) => source === 'system' ? '系统音' : '麦克风';

  return (
    <div className="relative">
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5 px-1">
        {/* Main One-Click Toggle Button */}
        {starting ? (
          <button onClick={stop} title="取消连接" className={cx(button.chip, 'bg-accent-soft text-accent-text hover:bg-accent-soft')}>
            <Loader2 size={13} className="animate-spin" />
            <span>连接中…</span>
          </button>
        ) : running ? (
          <button onClick={stop} className={cx(button.chip, 'bg-danger-soft text-danger hover:bg-danger-soft hover:text-danger pr-3')} title="点击停止监听 (快捷键: Cmd+Shift+G)">
            <span className="relative flex h-2 w-2">
              {!paused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />}
              <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
            </span>
            <span>{paused ? '监听已暂停' : pending ? `识别中(${pending})` : '正在听题'}</span>
            <span className="text-[11px] opacity-70">· 停止</span>
          </button>
        ) : (
          <button disabled={!sessionId} onClick={() => void start()} className={button.chip} title="开启实时语音监听 (快捷键: Cmd+Shift+G)">
            <Mic size={13} />
            <span>开始监听</span>
          </button>
        )}

        {/* Audio Mode Select */}
        <select value={mode} disabled={running || starting} onChange={e => setMode(e.target.value)} className={cx(selectField, 'rounded-full bg-transparent hover:bg-fill disabled:opacity-50')} title="选择音源模式">
          <option value="system">系统声音 (线上面试)</option>
          <option value="microphone">麦克风 (线下面试)</option>
          <option value="both">双音源 (系统+麦克风)</option>
        </select>

        {running && <>
          <button onClick={() => commands.current('listen')} className={cx(button.icon, 'h-7 w-7 rounded-full')} title={paused ? '继续监听' : '暂停监听'}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button onClick={() => void api.answerImmediately().catch((e: any) => setError(e.message))} className={cx(button.chip, 'text-accent-text')} title="立即触发回答 (Cmd+Shift+Enter)">
            <Zap size={12} />
            <span>立即回答</span>
          </button>
        </>}

        <label className="inline-flex items-center gap-1.5 h-7 px-1.5 text-[12px] text-label-2 hover:text-label">
          <input type="checkbox" checked={auto} onChange={e => { setAuto(e.target.checked); void api.controlListening({ auto: e.target.checked }).catch((e: any) => setError(e.message)); }} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          <span>自动回答</span>
        </label>
        <label className="inline-flex items-center gap-1.5 h-7 px-1.5 text-[12px] text-label-2 hover:text-label" title="自己回答期间开启，避免自己的话再次触发提问 (Cmd+Shift+M)">
          <input type="checkbox" checked={self} onChange={e => { setSelf(e.target.checked); void api.controlListening({ selfSpeaking: e.target.checked }).catch((e: any) => setError(e.message)); }} className="h-3.5 w-3.5 accent-[var(--accent)]" />
          <span>我正在说</span>
        </label>

        <div className="flex-1" />

        {(running || starting) && (
          <div className="flex items-center gap-2 text-[11px] text-label-2" role="status">
            <span className="@max-[640px]:hidden">自动分段转写 · </span><span>{starting ? '正在连接音源' : phase}</span><span className="@max-[640px]:hidden"> · {auto ? '自动回答开启' : '自动回答关闭'}</span>
            <span className="flex items-end gap-[2px] h-3" title={`输入电平 ${Math.round(meter * 100)}%`}>
              {[0.15, 0.35, 0.55, 0.75, 0.9].map(threshold => <span key={threshold} className={cx('w-[3px] rounded-full transition-colors', meter >= threshold ? 'bg-success' : 'bg-fill-strong')} style={{height: `${4 + threshold * 8}px`}} />)}
            </span>
          </div>
        )}

        {/* Transcript Drawer Toggle (Unobtrusive) */}
        {records.length > 0 && (
          <button onClick={() => setShowDrawer(!showDrawer)} className={cx(button.chip, showDrawer && 'bg-accent-soft text-accent-text')} title="查看实时字幕明细">
            <Captions size={13} />
            <span>字幕 ({records.length})</span>
          </button>
        )}
      </div>

      {(running || starting) && (Object.keys(health).length > 0 || pendingText || !auto) && (
        <div className="mt-1 px-2 space-y-0.5 text-[11px] text-label-2">
          {Object.keys(health).length > 0 && <div className="flex gap-3">{Object.entries(health).map(([source,h])=><span key={source}>{sourceName(source)}：{h.state} · 电平 {Math.min(100,Math.round(h.rms*500))}%</span>)}</div>}
          {pendingText && <div className="text-accent-text break-words">待提交：{pendingText}</div>}
          {!auto && <div className="text-warning">当前只转写，不会自动发题；点击“立即回答”或开启自动回答。</div>}
        </div>
      )}

      {/* Error Alert Banner */}
      {error && (
        <div className="mt-1.5">
          <Notice tone="danger" action={<>
            <button onClick={() => void api.openAudioPermissions(mode === 'microphone' ? 'microphone' : 'system').catch((e: any) => setError(e.message))} className={cx(button.link, 'h-6 text-[12px] text-danger hover:bg-danger-soft')}>打开权限</button>
            <button onClick={() => setError('')} className={cx(button.icon, 'h-6 w-6 text-danger')} title="关闭"><X size={12} /></button>
          </>}>
            <span className="inline-flex items-start gap-1.5"><AlertCircle size={13} className="shrink-0 mt-[2px]" />{error}</span>
          </Notice>
        </div>
      )}

      {/* Subtitles Popover / Drawer */}
      {showDrawer && <>
        <button aria-label="关闭字幕" className="fixed inset-0 z-40 cursor-default" onClick={() => setShowDrawer(false)} />
        <div className="absolute bottom-full right-0 mb-2 w-[420px] max-h-[360px] bg-elevated border border-separator rounded-2xl shadow-pop z-50 flex flex-col animate-fade-up">
          <div className="flex items-center justify-between px-4 h-11 border-b border-separator shrink-0">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-label">
              <Captions size={14} className="text-accent" />
              <span>实时字幕记录</span>
            </div>
            <button onClick={() => setShowDrawer(false)} className={button.icon} title="关闭"><X size={14} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {records.slice(-30).map(r => (
              <div key={r.id} className="rounded-lg px-2.5 py-2 hover:bg-fill">
                <div className="flex items-center justify-between text-[11px] text-label-3">
                  <span className="font-medium text-label-2">{r.source === 'system' ? '系统声音' : '麦克风'}</span>
                  {r.latencyMs !== undefined && <span className="tabular-nums">ASR {r.latencyMs}ms · 排队 {r.queuedMs ?? 0}ms{r.audioMs !== undefined ? ` · 音频 ${(r.audioMs/1000).toFixed(1)}s` : ''}</span>}
                </div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-label break-words select-text">
                  {r.ignored && <span className="text-label-3">已忽略应答词 · </span>}{r.status === 'pending' ? <span className="text-warning italic">转写中…</span> : r.text || r.error || '静音'}
                </div>
                <div className="flex items-center gap-1 pt-1">
                  {r.text && <button className={cx(button.link, 'h-6 text-[12px]')} onClick={() => { edit(r.text); setShowDrawer(false); }}>填入问题框 ↵</button>}
                  {r.status === 'error' && <button className={cx(button.link, 'h-6 text-[12px] text-warning hover:bg-warning-soft')} onClick={() => void api.retryTranscript(r.id).catch((e: any) => setError(e.message))}>重试转写</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
    </div>
  );
}
