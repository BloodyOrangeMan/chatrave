import { useCallback, useRef, useState } from 'react';
import type { AgentSettings } from '@chatrave/shared-types';
import { createVoiceAdapter } from './create-voice-service';
import type { VoiceAdapter, VoiceStatus } from './types';

interface UseVoiceInputOptions {
  settings: AgentSettings;
  disabled: boolean;
  onTranscript: (text: string) => void;
}

interface UseVoiceInputResult {
  status: VoiceStatus;
  error: string;
  toggle: () => Promise<void>;
}

export function useVoiceInput(options: UseVoiceInputOptions): UseVoiceInputResult {
  const adapterRef = useRef<VoiceAdapter | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState('');

  const toggle = useCallback(async () => {
    if (options.disabled) return;

    try {
      if (status === 'idle' || status === 'error') {
        setError('');
        const adapter = createVoiceAdapter(options.settings);
        adapterRef.current = adapter;
        setStatus('listening');
        await adapter.start();
        return;
      }

      if (status === 'listening') {
        setStatus('transcribing');
        const adapter = adapterRef.current;
        adapterRef.current = null;
        if (!adapter) throw new Error('Voice session not available.');
        const result = await adapter.stop();
        setStatus('idle');
        const text = result.text.trim();
        if (!text) {
          setError('No speech detected.');
          return;
        }
        options.onTranscript(text);
      }
    } catch (cause) {
      adapterRef.current = null;
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Voice input failed.');
    }
  }, [options, status]);

  return { status, error, toggle };
}
