export interface LlmDeltaEvent {
  turnId: string;
  textDelta: string;
}

export interface LlmCompletedEvent {
  turnId: string;
  outputText: string;
}

export interface LlmErrorEvent {
  turnId: string;
  code: 'auth' | 'rate_limit' | 'network' | 'parse' | 'unknown';
  message: string;
  retryable: boolean;
}
