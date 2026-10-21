import type { AudioSource } from '../../../main/types';
const processor = `class FrameCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1600); this.offset = 0; this.position = 0; this.sum = 0; this.count = 0; }
  process(inputs) {
    const input = inputs[0]; if (!input || !input[0]) return true;
    const ratio = sampleRate / 16000;
    for (let i = 0; i < input[0].length; i++) {
      let value = 0; for (const channel of input) value += channel[i];
      this.sum += value / input.length; this.count++;
      this.position += 1;
      if (this.position < ratio) continue;
      this.position -= ratio;
      this.buffer[this.offset++] = this.sum / this.count; this.sum = 0; this.count = 0;
      if (this.offset === this.buffer.length) { this.port.postMessage(this.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(1600); this.offset = 0; }
    }
    return true;
  }
} registerProcessor('interview-frame-capture', FrameCapture);`;
export class AudioCapture {
  private streams: MediaStream[] = [];
  private contexts: AudioContext[] = [];
  private nodes: AudioWorkletNode[] = [];
  private stopped = false;
  private sources = new Map<AudioSource,{track:MediaStreamTrack;lastFrame:number;lastSound:number;frames:number;rms:number}>();
  private monitor?: ReturnType<typeof setInterval>;
  async start(mode: string, send: (source: AudioSource, data: Float32Array) => void, level: (rms: number) => void, error: (message: string) => void, health: (sources: Record<string,{frames:number;rms:number;state:string}>)=>void = ()=>{}) {
    const started = Date.now(); let frames = 0;
    try {
      for (const source of (mode === 'none' ? [] : mode === 'both' ? ['system', 'microphone'] : [mode]) as AudioSource[]) {
        if (this.stopped) return;
        const stream = source === 'system'
          ? await navigator.mediaDevices.getDisplayMedia({video: {width: 16, height: 16, frameRate: 1}, audio: true})
          : await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}, video: false});
        if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        this.streams.push(stream);
        const track=stream.getAudioTracks()[0];
        if (!track || track.readyState==='ended') throw new Error('没有可用音轨，请检查系统音频/麦克风权限');
        this.sources.set(source,{track,lastFrame:Date.now(),lastSound:0,frames:0,rms:0});
        stream.getTracks().forEach(track => track.addEventListener('ended', () => {if (!this.stopped) {error('音源已断开，请重新开始监听'); this.stop();}}));
        const context = new AudioContext(); this.contexts.push(context);
        const url = URL.createObjectURL(new Blob([processor], {type: 'text/javascript'}));
        try { await context.audioWorklet.addModule(url); } finally {URL.revokeObjectURL(url);}
        if (this.stopped) return;
        const node = new AudioWorkletNode(context, 'interview-frame-capture'); this.nodes.push(node);
        const gain = context.createGain(); gain.gain.value = 0;
        context.createMediaStreamSource(stream).connect(node).connect(gain).connect(context.destination);
        node.port.onmessage = ({data}: MessageEvent<Float32Array>) => {
          if (this.stopped) return;
          frames++; let sum = 0; for (const x of data) sum += x*x;
          const rms=Math.sqrt(sum/data.length),state=this.sources.get(source)!;
          state.frames++;state.lastFrame=Date.now();state.rms=rms;if(rms>0.001)state.lastSound=Date.now();
          level(rms); send(source, data);
        };
        await context.resume();
      }
      this.monitor = setInterval(() => {
        for(const [source,state] of this.sources) {
          if(state.track.readyState==='ended'||Date.now()-state.lastFrame>5000) {
            error(`${source==='system'?'系统声音':'麦克风'}音轨已结束或未收到PCM采样，请检查对应权限和设备后重新开始`);this.stop();return;
          }
        }
        health(Object.fromEntries([...this.sources].map(([source,state])=>[source,{frames:state.frames,rms:state.rms,state:state.lastSound===0?'等待有效声音':Date.now()-state.lastSound>5000?'当前静音':'已收到声音'}])));
      }, 500);
    } catch (e) {this.stop(); throw e;}
  }
  stop() {
    this.stopped = true; clearInterval(this.monitor);
    for (const node of this.nodes) {node.port.onmessage = null; node.disconnect(); node.port.close();}
    this.streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    this.contexts.forEach(c => void c.close().catch(() => {}));
    this.nodes = []; this.streams = []; this.contexts = []; this.sources.clear();
  }
}
