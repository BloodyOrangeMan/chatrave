import type { StrudelKnowledgeInput } from '../contracts';
import { scoreCandidate } from '../common/fuzzy';
import { formatReferenceAnswer, formatSoundsAnswer } from './formatter';
import { parseKnowledgeQuery } from './query-parser';
import { buildReferenceIndex, type ReferenceDocItem } from './reference-index';
import { toKnowledgeNotFound, toKnowledgeSuccess } from './result';
import { rankReference, rankSounds } from './ranker';
import { buildSoundsIndex, type SoundEntry } from './sounds-index';

export interface KnowledgeSources {
  reference: ReferenceDocItem[];
  sounds: SoundEntry[];
}

export function executeStrudelKnowledge(input: StrudelKnowledgeInput, sources: KnowledgeSources) {
  const parsed = parseKnowledgeQuery(input.query);
  const referenceIndex = buildReferenceIndex(sources.reference);
  const soundsIndex = buildSoundsIndex(sources.sounds);

  const rankedReference =
    parsed.domain === 'sounds' ? [] : rankReference(parsed.q, referenceIndex).slice(0, parsed.limit);
  const rankedSounds = parsed.domain === 'reference' ? [] : rankSounds(parsed.q, soundsIndex).slice(0, parsed.limit);

  if (rankedReference.length === 0 && rankedSounds.length === 0) {
    const suggestions = [
      ...referenceIndex.map((item) => item.name),
      ...soundsIndex.map((item) => item.name),
    ]
      .map((name) => ({ name, score: scoreCandidate(parsed.q, name) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        const aDist = Math.abs(a.name.length - parsed.q.length);
        const bDist = Math.abs(b.name.length - parsed.q.length);
        if (aDist !== bDist) {
          return aDist - bDist;
        }
        return a.name.localeCompare(b.name);
      })
      .map((entry) => entry.name)
      .filter((name, index, arr) => arr.indexOf(name) === index)
      .slice(0, 5);
    return toKnowledgeNotFound(parsed.q, suggestions);
  }

  const answer =
    rankedReference.length >= rankedSounds.length
      ? formatReferenceAnswer(rankedReference, parsed.q)
      : formatSoundsAnswer(rankedSounds, parsed.q);

  return toKnowledgeSuccess(parsed.q, parsed.domain, answer, rankedReference, rankedSounds);
}
