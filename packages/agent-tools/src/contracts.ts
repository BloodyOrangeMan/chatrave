export type ToolName = 'read_code' | 'apply_strudel_change' | 'strudel_knowledge' | 'skill';

export interface ToolCall<TInput = unknown> {
  id: string;
  name: ToolName;
  input: TInput;
}

export interface ToolResult<TOutput = unknown> {
  id: string;
  name: ToolName;
  status: 'succeeded' | 'failed';
  output?: TOutput;
  error?: { message: string };
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface ReadCodeInput {
  path?: string;
  query?: string;
}

export interface ApplyStrudelChangeInput {
  baseHash: string;
  change:
    | {
        kind: 'full_code';
        content: string;
      }
    | {
        kind: 'search_replace';
        search: string;
        replace: string;
        occurrence?: 'single' | 'all';
      };
}

export interface StrudelKnowledgeInput {
  query:
    | string
    | {
        q: string;
        domain?: 'auto' | 'reference' | 'sounds';
        mode?: 'auto' | 'search' | 'detail' | 'list';
        limit?: number;
      };
}

export interface SkillToolInput {
  action: 'list' | 'get';
  id?: string;
  query?: string;
  limit?: number;
}
