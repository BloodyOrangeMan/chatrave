import { startRecording, type RecordingSession } from '../recorder';
import type { VoiceAdapter, VoiceResult } from '../types';

interface CompatibleConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  providerLabel: string;
}

interface TranscriptionResponse {
  text?: string;
}

function ensureConfigured(config: CompatibleConfig): void {
  if (!config.apiKey.trim()) throw new Error(`${config.providerLabel} API key is required.`);
  if (!config.baseUrl.trim()) throw new Error(`${config.providerLabel} base URL is required.`);
  if (!config.model.trim()) throw new Error(`${config.providerLabel} model is required.`);
}

async function transcribeBlob(config: CompatibleConfig, audio: Blob): Promise<VoiceResult> {
  const form = new FormData();
  form.append('file', audio, 'recording.webm');
  form.append('model', config.model);
  if (config.language.trim()) {
    form.append('language', config.language.trim());
  }

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${config.providerLabel} transcription failed (${response.status}): ${body || response.statusText}`);
  }

  const payload = (await response.json()) as TranscriptionResponse;
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  return { text };
}

export function createCompatibleTranscriptionAdapter(config: CompatibleConfig): VoiceAdapter {
  ensureConfigured(config);
  let recording: RecordingSession | null = null;

  return {
    async start() {
      recording = await startRecording();
    },
    async stop() {
      if (!recording) throw new Error('Voice recording was not started.');
      const current = recording;
      recording = null;
      const audio = await current.stop();
      return transcribeBlob(config, audio);
    },
  };
}
