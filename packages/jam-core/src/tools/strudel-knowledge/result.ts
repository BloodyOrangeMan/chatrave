import type { ReferenceIndexItem } from './reference-index';
import type { SoundIndexItem } from './sounds-index';

export function toKnowledgeSuccess(
  query: string,
  domain: 'reference' | 'sounds' | 'auto',
  answer: string,
  referenceItems: ReferenceIndexItem[],
  soundItems: SoundIndexItem[],
) {
  return {
    ok: true as const,
    query,
    domain,
    mode: 'search' as const,
    answer,
    items: [
      ...referenceItems.map((item) => ({
        kind: 'function' as const,
        name: item.name,
        description: item.description,
        usage: item.examples[0] ?? '',
        params: item.params,
        examples: item.examples.slice(0, 2),
        tags: item.tags,
        synonyms: item.synonyms,
      })),
      ...soundItems.map((item) => ({
        kind: 'sound' as const,
        name: item.name,
        type: item.type,
        tag: item.tag,
        prebake: item.prebake,
      })),
    ],
    sources: ['doc.json', 'soundMap'],
    notes: [] as string[],
  };
}

export function toKnowledgeNotFound(query: string, suggestions: string[]) {
  return {
    ok: false as const,
    query,
    reason: 'not_found' as const,
    answer: 'No authoritative match in bundled Strudel reference/sounds.',
    suggestions,
    sources: ['doc.json', 'soundMap'],
  };
}
