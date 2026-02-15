import type { ToolCall } from '@chatrave/agent-tools';

export interface MockStep {
  response?: string;
  thinking?: string;
  toolCalls?: Array<Pick<ToolCall, 'name' | 'input'>>;
}

export interface MockScenario {
  name: string;
  steps: MockStep[];
}

const SCENARIOS: Record<string, MockScenario> = {
  read_then_apply_success: {
    name: 'read_then_apply_success',
    steps: [
      {
        thinking:
          'Checking current REPL state and selecting the smallest safe change. Preparing an explicit read then apply flow.',
        toolCalls: [{ name: 'read_code', input: { path: 'active' } }],
      },
      {
        toolCalls: [
          {
            name: 'apply_strudel_change',
            input: {
              baseHash: 'fnv1a-811c9dc5',
              change: {
                kind: 'full_code',
                content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))',
              },
            },
          },
        ],
      },
      {
        response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))\n```',
      },
    ],
  },
  apply_repair_with_knowledge: {
    name: 'apply_repair_with_knowledge',
    steps: [
      {
        toolCalls: [
          {
            name: 'apply_strudel_change',
            input: {
              baseHash: 'fnv1a-811c9dc5',
              change: { kind: 'full_code', content: 'setcpm(120/4)\nstack(s("bd*4"), s("definitely_not_a_sound"))' },
            },
          },
        ],
      },
      {
        toolCalls: [{ name: 'strudel_knowledge', input: { query: { q: 'clap sound', domain: 'sounds' } } }],
      },
      {
        toolCalls: [
          {
            name: 'apply_strudel_change',
            input: {
              baseHash: 'fnv1a-811c9dc5',
              change: { kind: 'full_code', content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))' },
            },
          },
        ],
      },
      { response: 'Applied repaired groove with known sounds and preserved tempo continuity.' },
    ],
  },
  long_stream_visible_text: {
    name: 'long_stream_visible_text',
    steps: [
      {
        thinking:
          'Analyzing your request and current REPL context. Planning a safe update path with stable timing and conservative gain changes.',
        response:
          'I can build this in layers: start with a stable kick pulse, add tight closed hats, then introduce a restrained clap so the groove stays continuous. Once the foundation is locked, we can add one subtle variation every few bars to keep movement without destabilizing the loop.',
      },
    ],
  },
};

export function getAvailableMockScenarios(): string[] {
  return Object.keys(SCENARIOS).sort();
}

export function getMockScenario(name?: string): MockScenario {
  if (name && SCENARIOS[name]) {
    return SCENARIOS[name];
  }
  return SCENARIOS.long_stream_visible_text;
}
