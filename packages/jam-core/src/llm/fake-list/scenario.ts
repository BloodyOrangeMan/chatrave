export type FakeScenarioErrorCode = 'timeout' | 'network' | 'http' | 'parse';

export interface FakeToolCall {
  name: 'read_code' | 'apply_strudel_change' | 'strudel_knowledge';
  args: Record<string, unknown>;
}

export interface FakeScenarioStep {
  id: string;
  response?: string;
  toolCalls?: FakeToolCall[];
  error?: FakeScenarioErrorCode;
  delayMs?: number;
}

export interface FakeScenario {
  name: string;
  steps: FakeScenarioStep[];
}

export const BUILTIN_FAKE_SCENARIOS: Record<string, FakeScenario> = {
  successful_jam_apply: {
    name: 'successful_jam_apply',
    steps: [
      {
        id: 'apply-initial-groove',
        response: 'Applying a stable groove now.',
        toolCalls: [
          {
            name: 'apply_strudel_change',
            args: {
              baseHash: 'fnv1a-2f10d95b',
              change: {
                kind: 'full_code',
                content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"))',
              },
            },
          },
        ],
      },
      {
        id: 'final-code-block',
        response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```',
      },
    ],
  },
  read_then_apply_success: {
    name: 'read_then_apply_success',
    steps: [
      {
        id: 'read-active-first',
        response: 'I will inspect first.',
        toolCalls: [{ name: 'read_code', args: { path: 'active' } }],
      },
      {
        id: 'apply-after-read',
        response: 'Applying the updated groove.',
        toolCalls: [
          {
            name: 'apply_strudel_change',
            args: {
              baseHash: 'fnv1a-2f10d95b',
              change: {
                kind: 'full_code',
                content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))',
              },
            },
          },
        ],
      },
      {
        id: 'final-code',
        response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))\n```',
      },
    ],
  },
  early_finish_read_only: {
    name: 'early_finish_read_only',
    steps: [
      {
        id: 'read-only',
        response: 'I will inspect first.',
        toolCalls: [{ name: 'read_code', args: { path: 'active' } }],
      },
      {
        id: 'bad-followup',
        response: "I'll check the current code state first.",
      },
      {
        id: 'forced-final',
        response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```',
      },
    ],
  },
  jam_apply_rejected_unknown_sound: {
    name: 'jam_apply_rejected_unknown_sound',
    steps: [
      {
        id: 'apply-invalid-sound',
        response: 'Applying requested sound change.',
        toolCalls: [
          {
            name: 'apply_strudel_change',
            args: {
              baseHash: 'fnv1a-2f10d95b',
              change: {
                kind: 'full_code',
                content: 'setcpm(120/4)\nstack(s("bd*4"), s("definitely_not_a_sound"))',
              },
            },
          },
        ],
      },
      {
        id: 'apply-rejected-final',
        response: 'That sound is invalid in this environment. I kept the current groove unchanged.',
      },
    ],
  },
  jam_missing_apply_no_code: {
    name: 'jam_missing_apply_no_code',
    steps: [
      {
        id: 'analysis-only',
        response: 'I analyzed the groove and recommend adding hats and syncopated claps.',
      },
    ],
  },
  malformed_tool_tags: {
    name: 'malformed_tool_tags',
    steps: [
      {
        id: 'broken-tool-syntax',
        response:
          'I will inspect current code.\n' +
          '<|tool_calls_section_begin|> <|tool_call_begin|> functions.read_code:0 ' +
          '<|tool_call_argument_begin|> {"path":"active"}',
      },
      {
        id: 'forced-code',
        response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```',
      },
    ],
  },
  timeout_once: {
    name: 'timeout_once',
    steps: [
      {
        id: 'timeout',
        error: 'timeout',
      },
    ],
  },
};

export function getFakeScenario(name: string): FakeScenario {
  const scenario = BUILTIN_FAKE_SCENARIOS[name];
  if (!scenario) {
    throw new Error(`Unknown fake scenario: ${name}`);
  }
  return scenario;
}
