import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Loader2, Pause, Play, Zap, FileText, X, AlertCircle } from 'lucide-react';
import type { TranscriptRecord } from '../../../main/types';
import { AudioCapture } from '../services/audioCapture';

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

  return (
    <div className="relative">
      {/* Audio Capsule Bar */}
      <div className="flex items-center flex-wrap gap-2">
        {/* Main One-Click Toggle Button */}
        {starting ? (
          <button
            onClick={stop}
            title="取消连接"
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-800/50 border border-emerald-600/50 text-emerald-200 rounded-lg text-xs font-medium cursor-wait shadow-sm"
          >
            <Loader2 size={13} className="animate-spin text-emerald-300" />
            <span>连接中… 点击取消</span>
          </button>
        ) : running ? (
          <button
            onClick={stop}
            className="flex items-center space-x-2 px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/60 text-emerald-300 rounded-lg text-xs font-semibold shadow-sm shadow-emerald-950/50 transition-all group"
            title="点击停止监听 (快捷键: Cmd+Shift+G)"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
            <span>{paused ? '监听已暂停' : pending ? `识别中(${pending})` : '正在听题'}</span>
            <span className="text-[10px] text-emerald-400/70 group-hover:text-emerald-300 transition-colors">停止</span>
          </button>
        ) : (
          <button
            disabled={!sessionId}
            onClick={() => void start()}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-gray-200 border border-gray-700 rounded-lg text-xs font-medium shadow-sm transition-all disabled:opacity-40"
            title="开启实时语音监听 (快捷键: Cmd+Shift+G)"
          >
            <Mic size={13} className="text-emerald-400" />
            <span>开始监听</span>
          </button>
        )}

        {/* Audio Mode Select */}
        <select
          value={mode}
          disabled={running || starting}
          onChange={e => setMode(e.target.value)}
          className="bg-gray-800/90 hover:bg-gray-800 border border-gray-700/80 text-gray-300 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
          title="选择音源模式"
        >
          <option value="system">系统声音 (线上面试)</option>
          <option value="microphone">麦克风 (线下面试)</option>
          <option value="both">双音源 (系统+麦克风)</option>
        </select>

        {/* Action Controls when Running */}
        {running && (
          <div className="flex items-center space-x-1 bg-gray-900/80 p-0.5 rounded-lg border border-gray-800">
            <button
              onClick={() => commands.current('listen')}
              className="p-1 hover:bg-gray-800 text-gray-300 hover:text-white rounded transition-colors"
              title={paused ? '继续监听' : '暂停监听'}
            >
              {paused ? <Play size={12} className="text-emerald-400" /> : <Pause size={12} />}
            </button>
            <button
              onClick={() => void api.answerImmediately().catch((e: any) => setError(e.message))}
              className="flex items-center space-x-1 px-1.5 py-0.5 hover:bg-gray-800 text-emerald-400 hover:text-emerald-300 rounded text-[11px] font-medium transition-colors"
              title="立即触发回答 (Cmd+Shift+Enter)"
            >
              <Zap size={11} />
              <span>立即回答</span>
            </button>
          </div>
        )}

        {/* Subtle Checkbox Chips */}
        <div className="flex items-center space-x-2 text-[11px] text-gray-400">
          <label className="flex items-center space-x-1 cursor-pointer hover:text-gray-300 transition-colors">
            <input
              type="checkbox"
              checked={auto}
              onChange={e => {
                setAuto(e.target.checked);
                void api.controlListening({ auto: e.target.checked }).catch((e: any) => setError(e.message));
              }}
              className="rounded accent-emerald-500 w-3 h-3"
            />
            <span>自动回答</span>
          </label>
          <label className="flex items-center space-x-1 cursor-pointer hover:text-gray-300 transition-colors">
            <input
              type="checkbox"
              checked={self}
              onChange={e => {
                setSelf(e.target.checked);
                void api.controlListening({ selfSpeaking: e.target.checked }).catch((e: any) => setError(e.message));
              }}
              className="rounded accent-emerald-500 w-3 h-3"
            />
            <span>我正在说</span>
          </label>
        </div>

        {/* Transcript Drawer Toggle (Unobtrusive) */}
        {records.length > 0 && (
          <button
            onClick={() => setShowDrawer(!showDrawer)}
            className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
              showDrawer
                ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
            title="查看实时字幕明细"
          >
            <FileText size={11} />
            <span>字幕 ({records.length})</span>
          </button>
        )}
      </div>

      {(running || starting) && <div className="mt-2 text-xs text-gray-400 space-y-1" role="status">
        <div>自动分段转写 · {starting ? '正在连接音源' : phase} · {auto ? '自动回答开启' : '自动回答关闭'}</div>
        <div className="flex gap-3">{Object.entries(health).map(([source,h])=><span key={source}>{source==='system'?'系统音':'麦克风'}：{h.state} · 电平 {Math.min(100,Math.round(h.rms*500))}%</span>)}{!Object.keys(health).length&&<span>输入电平 {Math.min(100,Math.round(level*500))}%</span>}</div>
        {pendingText&&<div className="text-emerald-300 break-words">待提交：{pendingText}</div>}
        {!auto&&<div className="text-amber-300">当前只转写，不会自动发题；点击“立即回答”或开启自动回答。</div>}
      </div>}

      {/* Error Alert Banner */}
      {error && (
        <div
          role="alert"
          className="mt-2 flex items-center justify-between p-2 bg-red-950/70 border border-red-800/80 rounded-lg text-xs text-red-300 animate-in fade-in"
        >
          <div className="flex items-center space-x-1.5 flex-1 mr-2">
            <AlertCircle size={13} className="shrink-0 text-red-400" />
            <span className="truncate">{error}</span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => void api.openAudioPermissions(mode === 'microphone' ? 'microphone' : 'system').catch((e: any) => setError(e.message))}
              className="text-amber-400 underline hover:text-amber-300 text-[11px]"
            >
              打开权限
            </button>
            <button onClick={() => setError('')} className="text-gray-400 hover:text-gray-200">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Subtitles Popover / Drawer */}
      {showDrawer && (
        <div className="absolute top-full left-0 mt-2 w-96 max-h-72 bg-gray-950/95 border border-gray-800 rounded-xl shadow-2xl p-3 z-50 flex flex-col backdrop-blur-md">
          <div className="flex items-center justify-between pb-2 border-b border-gray-800 mb-2">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-200">
              <FileText size={13} className="text-emerald-400" />
              <span>实时字幕记录</span>
            </div>
            <button onClick={() => setShowDrawer(false)} className="text-gray-400 hover:text-gray-200 p-0.5 rounded">
              <X size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
            {records.slice(-30).map(r => (
              <div key={r.id} className="p-1.5 bg-gray-900/60 rounded border border-gray-800/80 flex flex-col space-y-1">
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span className="font-medium text-gray-400">{r.source === 'system' ? '系统声音' : '麦克风'}</span>
                  {r.latencyMs !== undefined && <span>ASR {r.latencyMs}ms · 排队 {r.queuedMs ?? 0}ms{r.audioMs !== undefined ? ` · 音频 ${(r.audioMs/1000).toFixed(1)}s` : ''}</span>}
                </div>
                <div className="text-gray-200 break-words">
                  {r.ignored && <span className="text-gray-500">已忽略应答词 · </span>}{r.status === 'pending' ? <span className="text-amber-400 italic">转写中…</span> : r.text || r.error || '静音'}
                </div>
                <div className="flex items-center space-x-2 pt-1 text-[10px]">
                  {r.text && (
                    <button
                      className="text-emerald-400 hover:text-emerald-300 font-medium"
                      onClick={() => {
                        edit(r.text);
                        setShowDrawer(false);
                      }}
                    >
                      填入问题框 ↵
                    </button>
                  )}
                  {r.status === 'error' && (
                    <button
                      className="text-amber-400 hover:text-amber-300"
                      onClick={() => void api.retryTranscript(r.id).catch((e: any) => setError(e.message))}
                    >
                      重试转写
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
