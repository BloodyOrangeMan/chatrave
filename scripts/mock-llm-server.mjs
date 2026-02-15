#!/usr/bin/env node
import http from 'node:http';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';

const host = process.env.CHATRAVE_MOCK_HOST || '127.0.0.1';
const port = Number(process.env.CHATRAVE_MOCK_PORT || 8787);
const defaultScenario = process.env.CHATRAVE_MOCK_SCENARIO || 'successful_jam_apply';
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-chatrave-mock-scenario',
};

const builtins = {
  successful_jam_apply: [
    {
      response: 'Applying a stable groove now.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            currentCode: '',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"))',
            },
          },
        },
      ],
    },
    { response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```' },
  ],
  read_then_apply_success: [
    { response: 'I will inspect first.', toolCalls: [{ name: 'read_code', args: { path: 'active' } }] },
    {
      response: 'Applying the updated groove.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            currentCode: '',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))',
            },
          },
        },
      ],
    },
    { response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))\n```' },
  ],
  early_finish_read_only: [
    { response: 'I will inspect first.', toolCalls: [{ name: 'read_code', args: { path: 'active' } }] },
    { response: "I'll inspect current pattern first." },
    { response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```' },
  ],
  jam_apply_rejected_unknown_sound: [
    {
      response: 'Applying requested sound change.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            currentCode: '',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("definitely_not_a_sound"))',
            },
          },
        },
      ],
    },
    { response: 'That sound is invalid in this environment. I kept the current groove unchanged.' },
  ],
  jam_missing_apply_no_code: [{ response: 'I analyzed the groove and recommend adding hats and syncopated claps.' }],
  multi_turn_apply_repair_with_knowledge: [
    {
      id: 'turn1-apply-initial',
      response: 'Applying a minimal groove to start.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            baseHash: 'fnv1a-811c9dc5',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"))',
            },
          },
        },
      ],
    },
    { id: 'turn1-final', response: 'Groove started. Kick and hats are stable at setcpm(120/4).' },
    {
      id: 'turn2-apply-bad',
      response: 'Applying clap + texture layer.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            baseHash: 'fnv1a-1de70543',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("definitely_not_a_sound"))',
            },
          },
        },
      ],
    },
    {
      id: 'turn2-knowledge',
      response: 'Checking Strudel sound knowledge for a safe replacement.',
      toolCalls: [
        {
          name: 'strudel_knowledge',
          args: {
            query: 'definitely_not_a_sound replacement clap',
          },
        },
      ],
    },
    {
      id: 'turn2-apply-repaired',
      response: 'Applying repaired pattern with known clap sample.',
      toolCalls: [
        {
          name: 'apply_strudel_change',
          args: {
            baseHash: 'fnv1a-1de70543',
            change: {
              kind: 'full_code',
              content: 'setcpm(120/4)\nstack(s("bd*4"), s("hh*8"), s("cp*2"))',
            },
          },
        },
      ],
    },
    { id: 'turn2-final', response: 'Repair applied. Groove stays stable and clap layer is active.' },
  ],
  malformed_tool_tags: [
    {
      response:
        'I will inspect current code.\n<|tool_calls_section_begin|> <|tool_call_begin|> functions.read_code:0 <|tool_call_argument_begin|> {"path":"active"}',
    },
    { response: '```javascript\nsetcpm(120/4)\nstack(s("bd*4"), s("hh*8"))\n```' },
  ],
  http_502_once: [{ error: 'HTTP_502' }],
  invalid_json_once: [{ error: 'INVALID_JSON' }],
};
const scenarioState = new Map();

function toLcMessage(message) {
  if (message?.role === 'assistant') return new AIMessage(message?.content ?? '');
  if (message?.role === 'system') return new SystemMessage(message?.content ?? '');
  return new HumanMessage(message?.content ?? '');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getScenarioName(req) {
  const header = req.headers['x-chatrave-mock-scenario'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return defaultScenario;
}

function renderToolCalls(step) {
  if (!Array.isArray(step?.toolCalls) || step.toolCalls.length === 0) {
    return '';
  }
  const invokes = step.toolCalls
    .map((call) => {
      return (
        '<|tool_call_begin|> ' +
        `functions.${call.name}:0 ` +
        '<|tool_call_argument_begin|> ' +
        `${JSON.stringify(call.args ?? {})} ` +
        '<|tool_call_end|>'
      );
    })
    .join(' ');
  return `<|tool_calls_section_begin|> ${invokes} <|tool_calls_section_end|>`;
}

function getLatestUserMessageContent(messages) {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === 'user' && typeof message?.content === 'string') {
      return message.content;
    }
  }
  return '';
}

function hasToolResult(latestUser, toolName) {
  return latestUser.includes(`"name": "${toolName}"`) || latestUser.includes(`"name":"${toolName}"`);
}

function hasToolOutputField(latestUser, field, value) {
  return latestUser.includes(`"${field}": "${value}"`) || latestUser.includes(`"${field}":"${value}"`);
}

function pickStep(name, messages) {
  const steps = builtins[name];
  if (!steps) {
    throw new Error(`Unknown mock scenario: ${name}`);
  }
  const state = scenarioState.get(name) || { multiTurnPhase: 0 };

  if (steps.length <= 1) {
    return steps[0];
  }

  const latestUser = getLatestUserMessageContent(messages);
  const hasToolResults = latestUser.includes('Tool results:');
  if (name === 'multi_turn_apply_repair_with_knowledge') {
    if (!hasToolResults) {
      if (state.multiTurnPhase >= 2) {
        state.multiTurnPhase = 0;
      }
      scenarioState.set(name, state);
      return state.multiTurnPhase === 0 ? steps[0] : steps[2];
    }
    if (hasToolResult(latestUser, 'strudel_knowledge')) {
      return steps[4];
    }
    if (
      hasToolResult(latestUser, 'apply_strudel_change') &&
      hasToolOutputField(latestUser, 'errorCode', 'UNKNOWN_SOUND')
    ) {
      return steps[3];
    }
    if (
      hasToolResult(latestUser, 'apply_strudel_change') &&
      (hasToolOutputField(latestUser, 'status', 'scheduled') || hasToolOutputField(latestUser, 'status', 'applied'))
    ) {
      return state.multiTurnPhase === 0 ? steps[1] : steps[5];
    }
    return state.multiTurnPhase === 0 ? steps[1] : steps[5];
  }

  if (!hasToolResults) {
    return steps[0];
  }

  const asksForcedFinal = latestUser.includes('previous answer was empty');
  if (name === 'read_then_apply_success') {
    if (hasToolResult(latestUser, 'apply_strudel_change')) {
      return steps[Math.min(2, steps.length - 1)];
    }
    if (hasToolResult(latestUser, 'read_code')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[Math.min(1, steps.length - 1)];
  }

  if (name === 'successful_jam_apply' || name === 'jam_apply_rejected_unknown_sound') {
    if (hasToolResult(latestUser, 'apply_strudel_change')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[0];
  }

  if (name === 'early_finish_read_only') {
    if (asksForcedFinal) {
      return steps[Math.min(2, steps.length - 1)];
    }
    if (hasToolResult(latestUser, 'read_code')) {
      return steps[Math.min(1, steps.length - 1)];
    }
    return steps[Math.min(1, steps.length - 1)];
  }

  if (asksForcedFinal) {
    return steps[Math.min(2, steps.length - 1)];
  }
  return steps[Math.min(1, steps.length - 1)];
}

async function generateResponse(messages, scenarioName) {
  const step = pickStep(scenarioName, messages);
  if (step?.error === 'HTTP_502') {
    const error = new Error('Mock upstream 502');
    error.code = 'HTTP_502';
    throw error;
  }
  if (step?.error === 'INVALID_JSON') {
    return '__INVALID_JSON__';
  }
  const renderedCalls = renderToolCalls(step);
  const text = [step?.response ?? '', renderedCalls].filter(Boolean).join('\n');
  const model = new FakeListChatModel({ responses: [text] });
  const output = await model.invoke((messages ?? []).map(toLcMessage));
  if (scenarioName === 'multi_turn_apply_repair_with_knowledge') {
    const state = scenarioState.get(scenarioName) || { multiTurnPhase: 0 };
    if (step?.id === 'turn1-final') {
      state.multiTurnPhase = 1;
      scenarioState.set(scenarioName, state);
    } else if (step?.id === 'turn2-final') {
      state.multiTurnPhase = 2;
      scenarioState.set(scenarioName, state);
    }
  }
  if (typeof output?.content === 'string') return output.content;
  if (Array.isArray(output?.content)) {
    return output.content
      .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/v1/scenarios') {
    sendJson(res, 200, { scenarios: Object.keys(builtins) });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') {
    sendJson(res, 404, { error: { message: 'Not found' } });
    return;
  }

  try {
    const body = await readJson(req);
    const scenarioName = getScenarioName(req);
    const content = await generateResponse(body.messages, scenarioName);
    if (content === '__INVALID_JSON__') {
      res.writeHead(200, { 'content-type': 'application/json', ...corsHeaders });
      res.end('{"choices":[{"message":{"content":');
      return;
    }
    sendJson(res, 200, {
      id: `mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model || 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
  } catch (error) {
    if (error && error.code === 'HTTP_502') {
      sendJson(res, 502, { error: { message: 'Mock upstream 502', code: 502 } });
      return;
    }
    sendJson(res, 500, { error: { message: (error && error.message) || 'Mock server error' } });
  }
});

server.listen(port, host, () => {
  console.log(`[chatrave][mock-llm] listening at http://${host}:${port}/api/v1/chat/completions`);
});
