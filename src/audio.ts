import type { TrackingSettings } from './tracking';

export type ServerMessage = { type: string; generation: number; stable?: string; partial?: string; message?: string; paragraph?: number; offset?: number; confidence?: number; inference_ms?: number; lag_ms?: number };
export type Anchor = { generation: number; paragraphs: string[]; paragraph: number; offset: number; paused: boolean; language: string; tracking: TrackingSettings };

export class Capture {
  socket?: WebSocket;
  context?: AudioContext;
  stream?: MediaStream;
  node?: AudioWorkletNode;
  sequence = 0;
  generation = 0;
  stopping = false;
  heartbeat?: number;
  flushResolve?: () => void;
  latestAnchor?: Anchor;
  constructor(private receive: (m: ServerMessage) => void, private level: (n: number) => void, private closed: () => void) {}

  async start(device: string, anchor: Anchor) {
    try {
      this.generation = anchor.generation;
      this.latestAnchor = anchor;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(device ? { deviceId: { exact: device } } : {}), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.context = new AudioContext();
      await this.context.resume();
      await this.context.audioWorklet.addModule('/pcm-worklet.js');
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = this.socket = new WebSocket(`${protocol}://${location.host}/ws/audio`);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('识别服务连接超时')), 10000);
        socket.onmessage = event => {
          const message: ServerMessage = JSON.parse(event.data);
          if (message.type === 'ready') { clearTimeout(timer); resolve(); }
          else if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); this.receive(message); }
          else this.receive(message);
        };
        socket.onerror = () => { clearTimeout(timer); reject(new Error('无法连接本地识别服务')); };
        socket.onclose = () => { clearTimeout(timer); reject(new Error('识别连接已断开')); this.dispose(); this.closed(); };
      });
      socket.send(JSON.stringify({ type: 'start', ...this.latestAnchor }));
      this.node = new AudioWorkletNode(this.context, 'pcm-capture', { processorOptions: { generation: this.generation } });
      this.node.port.onmessage = event => {
        if (event.data.type === 'flushed') { this.flushResolve?.(); return; }
        if (event.data.generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
        this.level(event.data.level);
        if (socket.bufferedAmount > 256000) {
          this.receive({ type: 'error', generation: this.generation, message: '音频发送积压，已停止识别。请检查本地服务后重新开始。' });
          this.dispose(); this.closed(); return;
        }
        const pcm: Int16Array = event.data.pcm;
        const payload = new ArrayBuffer(8 + pcm.byteLength);
        const view = new DataView(payload);
        view.setUint32(0, this.generation, true);
        view.setUint32(4, this.sequence++, true);
        for (let i = 0; i < pcm.length; i++) view.setInt16(8 + i * 2, pcm[i], true);
        socket.send(payload);
      };
      const source = this.context.createMediaStreamSource(this.stream);
      const mute = this.context.createGain(); mute.gain.value = 0;
      source.connect(this.node); this.node.connect(mute); mute.connect(this.context.destination);
      this.heartbeat = window.setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}'); }, 10000);
      this.stream.getAudioTracks()[0].onended = () => { if (!this.stopping) { this.receive({ type: 'error', generation: this.generation, message: '麦克风已断开，请重新选择输入设备' }); this.dispose(); this.closed(); } };
    } catch (error) { this.dispose(); throw error; }
  }

  reanchor(anchor: Anchor) {
    this.latestAnchor = anchor;
    this.generation = anchor.generation; this.sequence = 0;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'seek', ...anchor }));
    this.node?.port.postMessage({ type: 'reset', generation: anchor.generation });
  }

  configureTracking(tracking: TrackingSettings) {
    if (this.latestAnchor) this.latestAnchor = { ...this.latestAnchor, tracking };
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'tracking', generation: this.generation, tracking }));
  }

  async stop() {
    this.stopping = true;
    if (this.node) {
      await new Promise<void>(resolve => { this.flushResolve = resolve; this.node!.port.postMessage({ type: 'flush' }); setTimeout(resolve, 300); });
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.node?.disconnect();
    void this.context?.close().catch(() => {});
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send('{"type":"stop"}');
      await new Promise<void>(resolve => {
        this.socket!.addEventListener('close', () => resolve(), { once: true });
        setTimeout(resolve, 15000);
      });
    }
    this.dispose();
  }

  dispose() {
    this.stopping = true;
    clearInterval(this.heartbeat);
    this.stream?.getTracks().forEach(track => track.stop());
    this.node?.disconnect(); this.node = undefined;
    if (this.context?.state !== 'closed') void this.context?.close().catch(() => {});
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    this.level(0);
  }
}
