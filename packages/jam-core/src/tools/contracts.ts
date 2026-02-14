export type ToolName = 'read_code' | 'apply_strudel_change' | 'strudel_knowledge';

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
  currentCode: string;
  change: {
    kind: 'patch' | 'full_code';
    content: string;
  };
  policy?: {
    quantize: 'next_cycle' | 'next_bar';
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
