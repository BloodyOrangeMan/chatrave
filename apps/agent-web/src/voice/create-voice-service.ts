import type { AgentSettings } from '@chatrave/shared-types';
import { createCompatibleTranscriptionAdapter } from './providers/compatible-transcription';
import { createWebSpeechAdapter } from './providers/web-speech';
import type { VoiceAdapter } from './types';

export function createVoiceAdapter(settings: AgentSettings): VoiceAdapter {
  const voice = settings.voice;
  if (voice.provider === 'web_speech') {
    return createWebSpeechAdapter(voice.language);
  }
  return createCompatibleTranscriptionAdapter({
    apiKey: voice.openaiApiKey,
    baseUrl: voice.openaiBaseUrl,
    model: voice.openaiModel,
    language: voice.language,
    providerLabel: 'OpenAI',
  });
}
