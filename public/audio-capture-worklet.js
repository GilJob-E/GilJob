// AudioWorklet processor: takes whatever the AudioContext gives us (the
// constructor on the main thread asks for sampleRate=16000, so the browser
// resamples to that rate for us), buffers ~128ms chunks, converts to Int16,
// and ships them to main as transferable ArrayBuffers.

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._targetSize = 2048; // ~128ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this._buffer.push(channel[i]);
    }

    while (this._buffer.length >= this._targetSize) {
      const samples = this._buffer.splice(0, this._targetSize);
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(int16.buffer, [int16.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
