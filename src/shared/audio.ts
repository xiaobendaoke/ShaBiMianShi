/** The transport is fixed at 16 kHz mono Float32 PCM. */
export function encodeWav(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buffer);
  const str = (p: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return buffer;
}
export class SpeechSegmenter {
  private pre: number[] = []; private samples: number[] = []; private silence = 0;
  private voiced = 0;
  speaking = false;
  constructor(private emit: (pcm: Float32Array, ended: boolean) => void, private voice: () => void, private threshold = 0.012,
    private options: {maxChunkMs?: number; minSpeechMs?: number; onEnd?: () => void} = {}) {}
  push(frame: Float32Array) {
    let sum = 0; for (const x of frame) sum += x * x;
    const active = Math.sqrt(sum / Math.max(1, frame.length)) >= this.threshold;
    if (active) {
      this.voiced += frame.length;
      this.voice(); this.silence = 0;
      if (!this.speaking) { this.speaking = true; this.samples = this.pre; this.pre = []; }
    }
    if (!this.speaking) { this.pre.push(...frame); this.pre = this.pre.slice(-4800); return; }
    this.samples.push(...frame);
    if (!active) this.silence += frame.length;
    if (this.silence >= 9600) { this.finish(); return; }
    if (this.samples.length >= (this.options.maxChunkMs ?? 6000) * 16) {
      const pcm = Float32Array.from(this.samples); this.samples = this.samples.slice(-3200); this.voiced = Math.min(this.voiced, 3200); this.emit(pcm, false);
    }
  }
  finish() {
    if (this.speaking && this.samples.length >= 1600 && this.voiced >= (this.options.minSpeechMs ?? 0) * 16) this.emit(Float32Array.from(this.samples), true);
    const ended = this.speaking;
    this.samples = []; this.pre = []; this.silence = 0; this.voiced = 0; this.speaking = false;
    if (ended) this.options.onEnd?.();
  }
}
