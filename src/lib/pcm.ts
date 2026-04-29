// Helpers for moving raw PCM bytes between ArrayBuffer and base64 wire format.
// Live API audio fields are protobuf Blob: { mimeType, data: <base64> }.

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function int16BufferToFloat32(int16Buf: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(int16Buf);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    f32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
  }
  return f32;
}
