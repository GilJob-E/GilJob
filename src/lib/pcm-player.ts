import { base64ToArrayBuffer, int16BufferToFloat32 } from './pcm';

/**
 * Streaming player for 24kHz PCM16 audio chunks coming off the Live API.
 *
 * Each enqueue() call hands in a base64 chunk; the player schedules an
 * AudioBuffer source to play immediately after whatever is already queued
 * so chunks stitch together with no gap.
 */
export class PCMPlayer {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;

  /** Lazily create the AudioContext on first user-gesture-triggered play. */
  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 24000 });
      this.nextStartTime = this.ctx.currentTime;
    }
    return this.ctx;
  }

  enqueue(b64: string) {
    const ctx = this.getCtx();
    const buf = base64ToArrayBuffer(b64);
    const f32 = int16BufferToFloat32(buf);
    if (f32.length === 0) return;

    const audioBuf = ctx.createBuffer(1, f32.length, 24000);
    audioBuf.getChannelData(0).set(f32);

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + audioBuf.duration;
  }

  /** Cancel anything queued (server interruption / user cancel). */
  reset() {
    if (this.ctx) {
      this.nextStartTime = this.ctx.currentTime;
    }
  }

  async close() {
    try {
      if (this.ctx) await this.ctx.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}
