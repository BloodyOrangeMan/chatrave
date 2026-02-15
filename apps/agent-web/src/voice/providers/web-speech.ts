import type { VoiceAdapter, VoiceResult } from '../types';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}

interface SpeechCtor {
  new (): SpeechRecognitionLike;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechCtor;
    webkitSpeechRecognition?: SpeechCtor;
  }
}

function getSpeechCtor(): SpeechCtor | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function createWebSpeechAdapter(language: string): VoiceAdapter {
  const SpeechRecognition = getSpeechCtor();
  if (!SpeechRecognition) {
    throw new Error('Web Speech is not supported in this browser.');
  }

  const recognition = new SpeechRecognition();
  recognition.lang = language || 'en-US';
  recognition.interimResults = false;
  recognition.continuous = true;

  let transcript = '';
  let stopPromise: Promise<VoiceResult> | null = null;

  recognition.onresult = (event) => {
    const out: string[] = [];
    for (let i = 0; i < event.results.length; i += 1) {
      const alt = event.results[i]?.[0];
      if (alt?.transcript) out.push(alt.transcript);
    }
    transcript = out.join(' ').trim();
  };

  return {
    async start() {
      transcript = '';
      recognition.start();
    },
    async stop() {
      if (!stopPromise) {
        stopPromise = new Promise<VoiceResult>((resolve, reject) => {
          recognition.onerror = (event) => {
            stopPromise = null;
            reject(new Error(event?.error ? `Speech recognition failed: ${event.error}` : 'Speech recognition failed.'));
          };
          recognition.onend = () => {
            stopPromise = null;
            resolve({ text: transcript });
          };
          recognition.stop();
        });
      }
      return stopPromise;
    },
  };
}
