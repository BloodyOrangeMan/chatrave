import {
  type ApplyStrudelChangeInput,
  type ReadCodeInput,
  type StrudelKnowledgeInput,
  type ToolCall,
  type ToolResult,
} from './contracts';
import { executeApplyStrudelChange } from './apply-strudel-change/execute';
import { executeStrudelKnowledge, type KnowledgeSources } from './strudel-knowledge/execute';
import { toKnowledgeUnavailable } from './strudel-knowledge/result';

export interface ToolDispatcherContext {
  now?: () => number;
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<
    | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
    | {
        status: 'rejected';
        phase?: string;
        diagnostics?: string[];
        unknownSymbols?: string[];
        latestCode?: string;
        latestHash?: string;
        expectedBaseHash?: string;
      }
  >;
  knowledgeSources?: KnowledgeSources;
}

export async function dispatchToolCall(call: ToolCall, context: ToolDispatcherContext = {}): Promise<ToolResult> {
  const now = context.now ?? Date.now;
  const startedAt = now();

  try {
    if (call.name === 'read_code') {
      const output = context.readCode
        ? await context.readCode(call.input as ReadCodeInput)
        : { status: 'unavailable', reason: 'No read_code handler configured' };
      const endedAt = now();
      return { id: call.id, name: call.name, status: 'succeeded', output, startedAt, endedAt, durationMs: endedAt - startedAt };
    }

    if (call.name === 'apply_strudel_change') {
      const output = await executeApplyStrudelChange(call.input as ApplyStrudelChangeInput, {
        readCode: context.readCode,
        applyStrudelChange: context.applyStrudelChange,
      });
      const endedAt = now();
      return { id: call.id, name: call.name, status: 'succeeded', output, startedAt, endedAt, durationMs: endedAt - startedAt };
    }

    if (call.name === 'strudel_knowledge') {
      if (!context.knowledgeSources) {
        const input = call.input as StrudelKnowledgeInput;
        const query = typeof input?.query === 'string' ? input.query : input?.query?.q ?? '';
        const endedAt = now();
        return {
          id: call.id,
          name: call.name,
          status: 'succeeded',
          output: toKnowledgeUnavailable(query),
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
        };
      }
      const output = executeStrudelKnowledge(call.input as StrudelKnowledgeInput, context.knowledgeSources);
      const endedAt = now();
      return { id: call.id, name: call.name, status: 'succeeded', output, startedAt, endedAt, durationMs: endedAt - startedAt };
    }

    throw new Error(`Unknown tool: ${call.name}`);
  } catch (error) {
    const endedAt = now();
    return {
      id: call.id,
      name: call.name,
      status: 'failed',
      error: { message: (error as Error).message },
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
    };
  }
}
