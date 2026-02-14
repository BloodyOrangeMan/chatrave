/// <reference lib="webworker" />
import { createAgentRunner } from '../runner/create-agent-runner';
import type { WorkerRequest, WorkerResponse } from './protocol';

let runner: ReturnType<typeof createAgentRunner> | null = null;
let unsubscribe: (() => void) | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === 'init') {
      if (unsubscribe) {
        unsubscribe();
      }

      runner = createAgentRunner({ settings: request.payload.settings });
      unsubscribe = runner.subscribeToEvents((runnerEvent) => {
        post({ type: 'event', payload: runnerEvent });
      });
      post({ type: 'ready' });
      return;
    }

    if (!runner) {
      post({ type: 'error', payload: { message: 'Runner not initialized' } });
      return;
    }

    if (request.type === 'send') {
      await runner.sendUserMessage(request.payload.text);
      return;
    }

    if (request.type === 'stop') {
      runner.stopGeneration(request.payload?.turnId);
      return;
    }

    if (request.type === 'retry') {
      await runner.retryMessage(request.payload.messageId);
      return;
    }
  } catch (error) {
    post({ type: 'error', payload: { message: (error as Error).message } });
  }
};
