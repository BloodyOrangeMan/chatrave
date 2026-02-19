import { DirectChatTransport, type ChatTransport } from 'ai';
import { createJamAgent } from '@chatrave/agent-core';
import type { AgentSettings } from '@chatrave/shared-types';
import { dispatchToolCall, type StrudelKnowledgeInput, type ToolCall } from '@chatrave/agent-tools';
import { createStrudelBridge, type AgentHostContext } from '@chatrave/strudel-bridge';
import { isDevFakeUiEnabled, readRuntimeScenario } from './runtime-overrides';
import { createMockTransport } from './mock-transport';
import { SKILLS } from './skills/catalog';

export type { AgentHostContext } from '@chatrave/strudel-bridge';

export interface ChatRuntime {
  transport: ChatTransport<any>;
  clearActiveCode(): void;
  runDevKnowledge(input: StrudelKnowledgeInput): Promise<unknown>;
}

export function createChatRuntime(settings: AgentSettings, hostContext?: AgentHostContext): ChatRuntime {
  const bridge = createStrudelBridge(hostContext);
  const mockEnabled = isDevFakeUiEnabled();
  const scenario = readRuntimeScenario();

  const runTool = async (name: ToolCall['name'], input: unknown): Promise<unknown> => {
    const knowledgeSources = name === 'strudel_knowledge' ? await bridge.getKnowledgeSources() : undefined;
    const result = await dispatchToolCall(
      {
        id: `${name}-${Date.now()}`,
        name,
        input,
      },
      {
        readCode: bridge.readCode,
        applyStrudelChange: bridge.applyStrudelChange,
        knowledgeSources,
        skills: {
          list: () =>
            SKILLS.map((skill) => ({
              id: skill.id,
              name: skill.name,
              description: skill.description,
              tags: skill.tags,
            })),
          get: (id) => {
            const match = SKILLS.find((skill) => skill.id === id.trim());
            return match
              ? {
                  id: match.id,
                  name: match.name,
                  description: match.description,
                  tags: match.tags,
                  content: match.content,
                }
              : null;
          },
        },
      },
    );

    if (result.status === 'failed') {
      throw new Error(result.error?.message ?? `${name} failed`);
    }
    return result.output ?? {};
  };

  const transport = mockEnabled
    ? createMockTransport({
        scenarioName: scenario,
        runTool,
      })
    : (new DirectChatTransport({
        agent: createJamAgent({
          settings,
          skillsCatalog: SKILLS,
          maxSteps: 24,
          globalToolBudget: 40,
          maxRepairAttempts: 4,
          getReplSnapshot: bridge.getReplSnapshot,
          readCode: bridge.readCode,
          applyStrudelChange: bridge.applyStrudelChange,
          getKnowledgeSources: bridge.getKnowledgeSources,
        }),
      }) as ChatTransport<any>);

  return {
    transport,
    clearActiveCode() {
      bridge.clearActiveCode();
    },
    async runDevKnowledge(input) {
      const knowledgeSources = await bridge.getKnowledgeSources();
      const result = await dispatchToolCall(
        {
          id: `dev-knowledge-${Date.now()}`,
          name: 'strudel_knowledge',
          input,
        },
        { knowledgeSources },
      );
      return result.output ?? result.error ?? { status: 'unavailable' };
    },
  };
}
