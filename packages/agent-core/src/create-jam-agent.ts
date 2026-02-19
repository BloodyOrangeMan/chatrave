import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { dispatchToolCall, type KnowledgeSources, type ToolCall } from '@chatrave/agent-tools';
import { z } from 'zod';
import { buildSystemPrompt } from './system-prompt';
import type { CreateJamAgentConfig } from './types';

function mapReasoningEffort(mode: 'fast' | 'balanced' | 'deep'): 'low' | 'medium' | 'high' {
  if (mode === 'fast') return 'low';
  if (mode === 'deep') return 'high';
  return 'medium';
}

function createApplyInputSchema() {
  return z.object({
    baseHash: z.string().min(1, 'baseHash is required'),
    change: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('full_code'), content: z.string() }),
      z.object({
        kind: z.literal('search_replace'),
        search: z.string(),
        replace: z.string(),
        occurrence: z.enum(['single', 'all']).optional(),
      }),
    ]),
  });
}

function createReadInputSchema() {
  return z.object({ path: z.string().optional(), query: z.string().optional() }).passthrough();
}

function createKnowledgeInputSchema() {
  return z.object({
    query: z.union([
      z.string(),
      z.object({
        q: z.string(),
        domain: z.enum(['auto', 'reference', 'sounds']).optional(),
        mode: z.enum(['auto', 'search', 'detail', 'list']).optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
    ]),
  });
}

function createSkillInputSchema() {
  return z.discriminatedUnion('action', [
    z.object({
      action: z.literal('list'),
      query: z.string().optional(),
      limit: z.number().int().positive().max(50).optional(),
    }),
    z.object({
      action: z.literal('get'),
      id: z.string().min(1, 'id is required'),
    }),
  ]);
}

function createToolCallId(name: ToolCall['name']): string {
  return `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

const REDACT_KEYS = ['apikey', 'api_key', 'authorization', 'token', 'secret', 'password', 'credential', 'cookie'];

function shouldRedact(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEYS.some((needle) => lower.includes(needle));
}

function sanitizeForDebug(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((item) => sanitizeForDebug(item));
  if (!input || typeof input !== 'object') return input;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = shouldRedact(key) ? '•••' : sanitizeForDebug(value);
  }
  return output;
}

export function createJamAgent(config: CreateJamAgentConfig) {
  const provider = createOpenRouter({ apiKey: config.settings.apiKey });
  let cachedKnowledge: KnowledgeSources | undefined;
  const skillCatalog = config.settings.skillsEnabled && Array.isArray(config.skillsCatalog) ? config.skillsCatalog : [];
  const systemPrompt = buildSystemPrompt(skillCatalog.map((skill) => skill.name));

  const runTool = async (name: ToolCall['name'], input: unknown): Promise<unknown> => {
    if (name === 'strudel_knowledge' && !cachedKnowledge && config.getKnowledgeSources) {
      cachedKnowledge = await config.getKnowledgeSources();
    }

    const result = await dispatchToolCall(
      {
        id: createToolCallId(name),
        name,
        input,
      },
      {
        readCode: config.readCode,
        applyStrudelChange: config.applyStrudelChange as never,
        knowledgeSources: cachedKnowledge,
        skills: {
          list: () =>
            skillCatalog.map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              tags: Array.isArray(skill.tags) ? skill.tags : [],
            })),
          get: (id: string) => {
            const match = skillCatalog.find((skill) => skill.id === id.trim());
            if (!match) return null;
            return {
              id: match.id,
              name: match.name,
              description: match.description,
              tags: Array.isArray(match.tags) ? match.tags : [],
              content: match.content,
            };
          },
        },
      },
    );

    if (result.status === 'failed') {
      throw new Error(result.error?.message ?? `${name} failed`);
    }

    return result.output ?? {};
  };

  return new ToolLoopAgent({
    model: provider(config.settings.model),
    instructions: systemPrompt,
    temperature: config.settings.temperature,
    stopWhen: stepCountIs(config.maxSteps ?? 24),
    providerOptions: config.settings.reasoningEnabled
      ? { openrouter: { reasoning: { effort: mapReasoningEffort(config.settings.reasoningMode) } } }
      : undefined,
    tools: {
      read_code: tool({
        description: 'Read active code/context before editing.',
        inputSchema: createReadInputSchema(),
        execute: async (input) => runTool('read_code', input),
      }),
      apply_strudel_change: tool({
        description: 'Apply validated Strudel change with dry-run and quantized swap.',
        inputSchema: createApplyInputSchema(),
        execute: async (input) => runTool('apply_strudel_change', input),
      }),
      strudel_knowledge: tool({
        description: 'Lookup Strudel reference/sounds with fuzzy ranking.',
        inputSchema: createKnowledgeInputSchema(),
        execute: async (input) => runTool('strudel_knowledge', input),
      }),
      skill: tool({
        description: 'Load local genre/style skills (SKILL.md): list available skills or fetch one by id.',
        inputSchema: createSkillInputSchema(),
        execute: async (input) => runTool('skill', input),
      }),
    },
    prepareCall: async (options) => {
      const messagesPayload = (options as { messages?: unknown }).messages ?? (options as { prompt?: unknown }).prompt ?? null;
      const debugPayload = {
        model: config.settings.model,
        system: systemPrompt,
        providerOptions: options.providerOptions,
        tools: [
          { name: 'read_code', description: 'Read active code/context before editing.' },
          { name: 'apply_strudel_change', description: 'Apply validated Strudel change with dry-run and quantized swap.' },
          { name: 'strudel_knowledge', description: 'Lookup Strudel reference/sounds with fuzzy ranking.' },
          { name: 'skill', description: 'List/get local style skill docs.' },
        ],
        messages: messagesPayload,
      };
      const sanitized = sanitizeForDebug(debugPayload) as {
        system?: unknown;
        providerOptions?: unknown;
        tools?: unknown;
        messages?: unknown;
      };
      console.log('[chatrave][ai-request] systemPrompt', sanitized.system);
      console.log('[chatrave][ai-request] providerOptions', sanitized.providerOptions);
      console.log('[chatrave][ai-request] tools', sanitized.tools);
      console.log('[chatrave][ai-request] messages', sanitized.messages);
      return {
        ...options,
        instructions: systemPrompt,
      };
    },
  });
}
