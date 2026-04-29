/**
 * One-shot webcam frame grabber. Opens getUserMedia on demand, draws the
 * first available frame to a canvas, encodes JPEG, returns base64.
 *
 * The stream stops immediately after capture — we never hold the camera
 * during the rest of the turn.
 */

export async function captureWebcamJpeg(): Promise<{ b64: string; mimeType: string } | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.srcObject = stream;
    await video.play();

    // Wait for one frame to actually arrive
    await new Promise<void>(resolve => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
    });

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    const b64 = dataUrl.split(',', 2)[1] ?? '';
    return { b64, mimeType: 'image/jpeg' };
  } catch (e) {
    console.warn('webcam capture failed', e);
    return null;
  } finally {
    if (stream) stream.getTracks().forEach(t => t.stop());
  }
}
