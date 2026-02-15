export interface ReferenceDocItem {
  name: string;
  description?: string;
  params?: Array<{ name?: string; type?: string; description?: string }>;
  examples?: string[];
  tags?: Array<string | { title?: string; value?: string; text?: string }>;
  synonyms?: string[];
}

export interface ReferenceIndexItem {
  name: string;
  description: string;
  params: Array<{ name: string; type: string; description: string }>;
  examples: string[];
  tags: string[];
  synonyms: string[];
}

function normalizeTag(tag: string | { title?: string; value?: string; text?: string }): string | null {
  if (typeof tag === 'string') {
    return tag;
  }
  return tag.value ?? tag.text ?? tag.title ?? null;
}

export function buildReferenceIndex(items: ReferenceDocItem[]): ReferenceIndexItem[] {
  return items
    .filter((item) => item.name && !item.name.startsWith('_'))
    .map((item) => ({
      name: item.name,
      description: item.description ?? '',
      params: (item.params ?? []).map((param) => ({
        name: param.name ?? '',
        type: param.type ?? '',
        description: param.description ?? '',
      })),
      examples: item.examples ?? [],
      tags: (item.tags ?? []).map(normalizeTag).filter((tag): tag is string => Boolean(tag)),
      synonyms: item.synonyms ?? [],
    }));
}
