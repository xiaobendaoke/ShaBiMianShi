import type { AudioSource, TranscriptRecord } from '../types';
import { SpeechSegmenter, encodeWav } from '../../shared/audio';
import { isQuestion, isFiller, mergeTranscript } from '../../shared/interview';

interface Segment { record: TranscriptRecord; wav: ArrayBuffer; ended: boolean; eligible: boolean; settled: boolean; voiceEndedAt:number; }
interface Capture {
  id: string; sessionId: string; owner: number; segments: Segment[]; readers: Map<AudioSource, SpeechSegmenter>;
  controller: AbortController; speaking: Set<AudioSource>; pendingText: string; next: number; pendingVoiceEndedAt: number;
  lastVoice: number; auto: boolean; selfSpeaking: boolean; mode: string; timer: ReturnType<typeof setInterval>; paused: boolean; force: boolean;
}
export class AudioSessionService {
  private capture?: Capture;
  private inFlight = 0;
  private stopped = false;
  private lastState = "";
  private failed = new Map<string, Segment>();
  owns(owner:number,id:string,sessionId:string){return this.capture?.owner===owner&&this.capture.id===id&&this.capture.sessionId===sessionId;}
  constructor(private transcribe: (wav: Buffer, signal: AbortSignal) => Promise<string>, private notify: (channel: string, data: any) => void,
    private save: (record: TranscriptRecord) => void, private submit: (sessionId: string, question: string, timing?: {voiceEndedAt:number; submittedAt:number}) => void,
    private blocked: () => boolean) {}
  start(sessionId: string, owner: number, mode: string, auto = true) {
    this.stop(); this.failed.clear(); this.stopped = false; this.lastState = "";
    const id = crypto.randomUUID();
    const c: Capture = { id, sessionId, owner, mode, auto, selfSpeaking: false, paused: false, force: false, segments: [], readers: new Map(), speaking: new Set(), controller: new AbortController(), pendingText: '', pendingVoiceEndedAt: 0, next: 0, lastVoice: Date.now(), timer: setInterval(() => this.flush(), 100) };
    for (const source of (mode === 'both' ? ['system', 'microphone'] : [mode]) as AudioSource[]) {
      c.readers.set(source, new SpeechSegmenter((pcm, ended) => {
        if (ended) c.speaking.delete(source);
        const record: TranscriptRecord = { id: crypto.randomUUID(), sessionId, captureId: id, sequence: c.segments.length, source, text: '', status: 'pending', createdAt: Date.now(), audioMs: Math.round(pcm.length / 16) };
        const segment = { record, wav: encodeWav(pcm), ended, eligible: (mode !== 'both' || source === 'system') && !c.selfSpeaking, settled: false, voiceEndedAt:c.lastVoice };
        c.segments.push(segment); this.save(record); this.notify('audio:transcript', record); this.pump(); this.state();
      }, () => { c.speaking.add(source); c.lastVoice = Date.now(); }, 0.012, {maxChunkMs:4000, minSpeechMs:200, onEnd:()=>{c.speaking.delete(source);this.state();}}));
    }
    this.capture = c; this.state(); return id;
  }
  frame(owner: number, id: string, source: AudioSource, data: Float32Array) {
    const c = this.capture;
    if (!c || c.owner !== owner || c.id !== id || this.stopped || c.paused) return;
    if (!(data instanceof Float32Array) || data.length > 3200 || !data.length) return;
    if (data.some(x => !Number.isFinite(x))) return;
    c.readers.get(source)?.push(data);
  }
  control(owner: number, changes: { auto?: boolean; selfSpeaking?: boolean; paused?: boolean }) {
    const c = this.capture; if (!c || c.owner !== owner) return;
    if (changes.selfSpeaking !== undefined && changes.selfSpeaking !== c.selfSpeaking) {
      for (const reader of c.readers.values()) reader.finish();
      c.pendingText = ''; c.force = false; c.selfSpeaking = changes.selfSpeaking;
    }
    if (changes.paused !== undefined) { for (const r of c.readers.values()) r.finish(); c.speaking.clear(); c.paused = changes.paused; }
    if (changes.auto !== undefined) {
      if (changes.auto && !c.auto) {c.pendingText = ''; for (const item of c.segments) if(item.record.status==='pending') item.eligible=false;}
      c.auto = changes.auto;
    }
    this.state();
  }
  stop(owner?: number) {
    const c = this.capture; if (!c || (owner !== undefined && owner !== c.owner)) return;
    clearInterval(c.timer); c.controller.abort(); this.stopped = true;
    for (const s of c.segments.filter(s => s.record.status === 'pending')) { s.record.status = 'error'; s.record.error = '监听已停止，片段未提交；可手动重新录入'; this.save(s.record); }
    this.capture = undefined; this.failed.clear(); this.notify('audio:state', {sessionId: c.sessionId, captureId: c.id, running: false});
  }
  stopOtherSession(sessionId: string) { if (this.capture?.sessionId !== sessionId) this.stop(); }
  stopSession(sessionId: string) { if (this.capture?.sessionId === sessionId) this.stop(); }
  private pump() {
    const c = this.capture; if (!c || this.stopped) return;
    while (this.inFlight < 2) {
      const item = c.segments.find(s => s.record.status === 'pending' && !s.settled);
      if (!item) break;
      item.settled = true; this.inFlight++; const start = Date.now(); item.record.queuedMs = start - item.record.createdAt;
      void Promise.resolve().then(() => this.transcribe(Buffer.from(item.wav), c.controller.signal)).then(text => {
        if (this.capture !== c) return;
        item.record.text = text; item.record.status = 'completed'; item.record.latencyMs = Date.now() - start; item.record.completedAt=Date.now(); item.record.ignored=isFiller(text);
      }, error => {
        if (this.capture !== c) return;
        item.record.status = 'error'; item.record.error = error.message;
        if (this.failed.size < 12) this.failed.set(item.record.id, item);
      }).finally(() => {
        this.inFlight--;
        if (this.capture === c) { this.save(item.record); this.notify('audio:transcript', item.record); this.merge(c); this.flush(); this.state(); }
        this.pump();
      });
    }
    // Bound memory and latency during network failures; stop visibly instead of dropping audio.
    if (c.segments.filter(s => s.record.status === 'pending').length > 12) { this.notify('audio:error', {sessionId: c.sessionId, captureId:c.id, error: '转写积压过多，监听已停止。请检查网络后重新开始。'}); this.stop(); }
  }
  private merge(c: Capture) {
    while (c.next < c.segments.length && c.segments[c.next].record.status !== 'pending') {
      const s = c.segments[c.next++];
      if (s.record.status === 'error') { c.pendingText = ''; c.auto = false; c.force = false; }
      else if (s.eligible && !s.record.ignored) {c.pendingText = mergeTranscript(c.pendingText, s.record.text);c.pendingVoiceEndedAt=s.voiceEndedAt;}
      s.wav = this.failed.has(s.record.id) ? s.wav : new ArrayBuffer(0);
    }
  }
  private flush() {
    const c = this.capture;
    this.state();
    if (!c || this.blocked() || c.next !== c.segments.length || (!c.force && (!c.auto || c.selfSpeaking || c.paused || c.speaking.size || Date.now() - c.lastVoice < 650))) return;
    if (!c.pendingText.trim()) {c.force = false; return;}
    if (isQuestion(c.pendingText) || (c.force && c.pendingText.trim())) { const q = c.pendingText; c.pendingText = ''; c.force=false; this.submit(c.sessionId, q, {voiceEndedAt:c.pendingVoiceEndedAt,submittedAt:Date.now()}); this.state(); }
  }
  immediate(owner: number) {
    const c = this.capture; if (!c || c.owner !== owner) return;
    for (const r of c.readers.values()) r.finish();
    c.lastVoice = 0; c.force = true;
    if (c.next === c.segments.length && c.pendingText.trim() && !this.blocked()) {const text=c.pendingText;c.pendingText='';c.force=false;this.submit(c.sessionId,text,{voiceEndedAt:c.pendingVoiceEndedAt,submittedAt:Date.now()});this.state();}
    else this.flush();
  }
  async retry(owner: number, id: string) {
    const c = this.capture, item = this.failed.get(id);
    if (!c || c.owner !== owner || !item || item.record.captureId !== c.id) throw new Error('失败音频已清理，请重新录入');
    if (this.inFlight >= 2) throw new Error('正在转写，请稍后重试');
    this.inFlight++;
    try { const text = await this.transcribe(Buffer.from(item.wav), c.controller.signal); if (this.capture !== c) return; item.record = {...item.record, status: 'completed', text, error: undefined}; this.failed.delete(id); item.wav = new ArrayBuffer(0); this.save(item.record); this.notify('audio:transcript', item.record); }
    finally { this.inFlight--; this.pump(); }
  }
  private state() {
    const c = this.capture; if (!c) return;
    const pending=c.segments.filter(s=>s.record.status==='pending').length;
    const phase=c.paused?'监听已暂停':c.selfSpeaking?'我正在回答':this.blocked()?'选区期间暂缓提交':
      c.speaking.size?'正在收音':pending?'等待转写完成':!c.auto&&!c.force?'手动模式，请点立即回答':
      c.pendingText?(isQuestion(c.pendingText)?'等待停顿后自动提交':'等待完整问题'):'等待说话';
    const value={sessionId:c.sessionId,captureId:c.id,running:true,auto:c.auto,paused:c.paused,selfSpeaking:c.selfSpeaking,pending,text:c.pendingText,phase};
    const key=JSON.stringify(value);if(key===this.lastState)return;this.lastState=key;
    this.notify('audio:state',value);
  }
}
