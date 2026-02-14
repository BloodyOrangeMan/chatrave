import type { AgentSettings, RunnerEvent } from '@chatrave/shared-types';
import type { WorkerRequest, WorkerResponse } from '@chatrave/jam-core';

export interface RunnerWorkerClient {
  send(text: string): void;
  stop(turnId?: string): void;
  retry(messageId: string): void;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
}

export function createRunnerWorkerClient(settings: AgentSettings): RunnerWorkerClient {
  const worker = new Worker(new URL('@chatrave/jam-core/src/worker/runner.worker.ts', import.meta.url), {
    type: 'module',
  });
  const listeners = new Set<(event: RunnerEvent) => void>();

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type !== 'event') {
      return;
    }
    for (const listener of listeners) {
      listener(message.payload);
    }
  };

  worker.postMessage({ type: 'init', payload: { settings } } satisfies WorkerRequest);

  return {
    send(text) {
      worker.postMessage({ type: 'send', payload: { text } } satisfies WorkerRequest);
    },
    stop(turnId) {
      worker.postMessage({ type: 'stop', payload: { turnId } } satisfies WorkerRequest);
    },
    retry(messageId) {
      worker.postMessage({ type: 'retry', payload: { messageId } } satisfies WorkerRequest);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
