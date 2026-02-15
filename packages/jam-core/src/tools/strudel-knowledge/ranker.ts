import { scoreCandidate } from '../common/fuzzy';
import type { ReferenceIndexItem } from './reference-index';
import type { SoundIndexItem } from './sounds-index';

function tieBreak(query: string, a: string, b: string): number {
  const qLen = query.trim().length;
  const aDist = Math.abs(a.length - qLen);
  const bDist = Math.abs(b.length - qLen);
  if (aDist !== bDist) {
    return aDist - bDist;
  }
  return a.localeCompare(b);
}

export function rankReference(query: string, items: ReferenceIndexItem[]): ReferenceIndexItem[] {
  return [...items]
    .map((item) => ({
      item,
      score: (() => {
        const nameScore = scoreCandidate(query, item.name);
        const synonymScores = item.synonyms.map((synonym) => scoreCandidate(query, synonym));
        const synonymScore = synonymScores.length > 0 ? Math.max(...synonymScores) : 0;
        const dualHitBonus = nameScore > 0 && synonymScore > 0 ? 8 : 0;
        return Math.max(nameScore, synonymScore) + dualHitBonus;
      })(),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return tieBreak(query, a.item.name, b.item.name);
    })
    .map((entry) => entry.item);
}

export function rankSounds(query: string, items: SoundIndexItem[]): SoundIndexItem[] {
  return [...items]
    .map((item) => ({ item, score: scoreCandidate(query, item.name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return tieBreak(query, a.item.name, b.item.name);
    })
    .map((entry) => entry.item);
}
