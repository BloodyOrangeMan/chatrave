import type { ReferenceIndexItem } from './reference-index';
import type { SoundIndexItem } from './sounds-index';

export function formatReferenceAnswer(items: ReferenceIndexItem[], query: string): string {
  if (items.length === 0) {
    return `No authoritative Strudel reference match for "${query}".`;
  }
  return `Found ${items.length} reference matches for "${query}".`;
}

export function formatSoundsAnswer(items: SoundIndexItem[], query: string): string {
  if (items.length === 0) {
    return `No authoritative sound match for "${query}".`;
  }
  return `Found ${items.length} sound matches for "${query}".`;
}
