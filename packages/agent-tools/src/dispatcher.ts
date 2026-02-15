import {
  type ApplyStrudelChangeInput,
  type ReadCodeInput,
  type SkillToolInput,
  type StrudelKnowledgeInput,
  type ToolCall,
  type ToolResult,
} from './contracts';
import { executeApplyStrudelChange } from './apply-strudel-change/execute';
import { executeStrudelKnowledge, type KnowledgeSources } from './strudel-knowledge/execute';
import { toKnowledgeUnavailable } from './strudel-knowledge/result';

function normalizeSkillKey(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

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
  skills?: {
    list: () =>
      | Array<{ id: string; name: string; description?: string; tags?: string[] }>
      | Promise<Array<{ id: string; name: string; description?: string; tags?: string[] }>>;
    get: (id: string) =>
      | { id: string; name: string; description?: string; tags?: string[]; content: string }
      | null
      | Promise<{ id: string; name: string; description?: string; tags?: string[]; content: string } | null>;
  };
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

    if (call.name === 'skill') {
      const input = (call.input ?? {}) as SkillToolInput;
      if (!context.skills) {
        const endedAt = now();
        return {
          id: call.id,
          name: call.name,
          status: 'succeeded',
          output: { ok: false, reason: 'unavailable', message: 'Skill registry is not configured.' },
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
        };
      }

      if (input.action === 'get') {
        const id = typeof input.id === 'string' ? input.id.trim() : '';
        if (!id) {
          const endedAt = now();
          return {
            id: call.id,
            name: call.name,
            status: 'succeeded',
            output: { ok: false, reason: 'invalid_input', message: 'id is required when action=get' },
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          };
        }

        let detail = await context.skills.get(id);
        if (!detail) {
          const requestedKey = normalizeSkillKey(id);
          const candidates = await context.skills.list();
          const aliasMatch = candidates.find((skill) => {
            const idKey = normalizeSkillKey(skill.id);
            const nameKey = normalizeSkillKey(skill.name);
            return idKey === requestedKey || nameKey === requestedKey;
          });
          if (aliasMatch) {
            detail = await context.skills.get(aliasMatch.id);
          }
        }
        const endedAt = now();
        if (!detail) {
          const available = (await context.skills.list()).map((skill) => skill.id);
          return {
            id: call.id,
            name: call.name,
            status: 'succeeded',
            output: { ok: false, action: 'get', reason: 'not_found', id, available },
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
          };
        }

        return {
          id: call.id,
          name: call.name,
          status: 'succeeded',
          output: { ok: true, action: 'get', skill: detail },
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
        };
      }

      const list = await context.skills.list();
      const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
      const limit = Math.max(1, Math.min(50, Number.isFinite(input.limit) ? Number(input.limit) : 20));
      const ranked = list
        .map((skill, index) => {
          const tags = Array.isArray(skill.tags) ? skill.tags.join(' ').toLowerCase() : '';
          const haystack = `${skill.id} ${skill.name} ${skill.description ?? ''} ${tags}`.toLowerCase();
          const score = query ? (haystack.includes(query) ? 1 : 0) : 1;
          return { score, index, skill };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit)
        .map((item) => item.skill);
      const endedAt = now();
      return {
        id: call.id,
        name: call.name,
        status: 'succeeded',
        output: { ok: true, action: 'list', total: ranked.length, skills: ranked },
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      };
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
