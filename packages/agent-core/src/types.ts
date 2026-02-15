import type { AgentSettings, ReplSnapshot } from '@chatrave/shared-types';
import type { ApplyStrudelChangeInput, ReadCodeInput } from '@chatrave/agent-tools';
import type { KnowledgeSources } from '@chatrave/agent-tools';

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  tags?: string[];
  content: string;
}

export interface JamToolContext {
  getReplSnapshot?: () => ReplSnapshot;
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (input: ApplyStrudelChangeInput) => Promise<unknown>;
  getKnowledgeSources?: () => Promise<KnowledgeSources | undefined> | KnowledgeSources | undefined;
}

export interface CreateJamAgentConfig extends JamToolContext {
  settings: AgentSettings;
  skillsCatalog?: SkillDefinition[];
  maxSteps?: number;
  maxRepairAttempts?: number;
  globalToolBudget?: number;
  modelTimeoutMs?: number;
}
