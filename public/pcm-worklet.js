// Area-weighted downsampling preserves the real duration at 44.1/48/96 kHz.
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.generation = options.processorOptions.generation;
    this.ratio = sampleRate / 16000; this.acc = 0; this.weight = 0;
    this.buffer = new Int16Array(1600); this.used = 0; this.energy = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'reset') { this.generation = data.generation; this.acc = this.weight = this.used = this.energy = 0; }
      if (data.type === 'flush') { this.emit(); this.port.postMessage({ type: 'flushed' }); }
    };
  }
  emit() {
    if (!this.used) return;
    const pcm = this.buffer.slice(0, this.used);
    this.port.postMessage({ pcm, generation: this.generation, level: Math.sqrt(this.energy / this.used) }, [pcm.buffer]);
    this.used = this.energy = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.acc += sample * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          const value = Math.max(-1, Math.min(1, this.acc / this.ratio));
          this.buffer[this.used++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.energy += value * value; this.acc = this.weight = 0;
          if (this.used === this.buffer.length) this.emit();
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
