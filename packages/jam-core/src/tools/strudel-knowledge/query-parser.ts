import type { StrudelKnowledgeInput } from '../contracts';

export interface ParsedKnowledgeQuery {
  q: string;
  domain: 'auto' | 'reference' | 'sounds';
  mode: 'auto' | 'search' | 'detail' | 'list';
  limit: number;
}

export function parseKnowledgeQuery(input: StrudelKnowledgeInput['query']): ParsedKnowledgeQuery {
  if (typeof input === 'string') {
    return { q: input.trim(), domain: 'auto', mode: 'auto', limit: 5 };
  }

  return {
    q: input.q.trim(),
    domain: input.domain ?? 'auto',
    mode: input.mode ?? 'auto',
    limit: Math.max(1, Math.min(10, input.limit ?? 5)),
  };
}
