import { arrayBufferToBase64 } from './pcm';

export interface AudioCaptureHandle {
  stop: () => Promise<void>;
}

export interface AudioCaptureOptions {
  /** Called for each ~128ms chunk of base64 PCM16 16kHz mono. */
  onChunk: (b64: string) => void;
  /** Called once with the underlying MediaStream so callers can mute/unmute. */
  onStream?: (stream: MediaStream) => void;
}

/**
 * Open the mic at 16kHz PCM, route through an AudioWorklet that emits
 * Int16 ArrayBuffers, base64-encode each chunk, and hand it to onChunk.
 */
export async function startAudioCapture(
  opts: AudioCaptureOptions,
): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });
  opts.onStream?.(stream);

  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule('/audio-capture-worklet.js');

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    opts.onChunk(arrayBufferToBase64(e.data));
  };

  source.connect(node);
  // Worklet output is unused but must be reachable from destination for the
  // graph to actually pull samples in some browsers.
  node.connect(ctx.destination);

  return {
    async stop() {
      try {
        node.disconnect();
        source.disconnect();
        stream.getTracks().forEach(t => t.stop());
        await ctx.close();
      } catch {
        // best-effort cleanup
      }
    },
  };
}
