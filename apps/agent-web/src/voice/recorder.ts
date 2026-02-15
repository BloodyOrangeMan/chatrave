const DEFAULT_MIME = 'audio/webm;codecs=opus';

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return DEFAULT_MIME;
  if (MediaRecorder.isTypeSupported(DEFAULT_MIME)) return DEFAULT_MIME;
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  return '';
}

export interface RecordingSession {
  mimeType: string;
  stop: () => Promise<Blob>;
}

export async function startRecording(): Promise<RecordingSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not supported in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  recorder.start();

  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => {
          reject(new Error('Recording failed.'));
        };
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        };
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
        }
      }),
  };
}
