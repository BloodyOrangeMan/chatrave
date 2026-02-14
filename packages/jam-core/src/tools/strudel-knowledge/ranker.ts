import { scoreCandidate } from '../common/fuzzy';
import type { ReferenceIndexItem } from './reference-index';
import type { SoundIndexItem } from './sounds-index';

export function rankReference(query: string, items: ReferenceIndexItem[]): ReferenceIndexItem[] {
  return [...items]
    .map((item) => ({
      item,
      score: Math.max(
        scoreCandidate(query, item.name),
        ...item.synonyms.map((synonym) => scoreCandidate(query, synonym)),
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

export function rankSounds(query: string, items: SoundIndexItem[]): SoundIndexItem[] {
  return [...items]
    .map((item) => ({ item, score: scoreCandidate(query, item.name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
