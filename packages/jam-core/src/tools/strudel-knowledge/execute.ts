import type { StrudelKnowledgeInput } from '../contracts';
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
      ...referenceIndex.slice(0, 3).map((item) => item.name),
      ...soundsIndex.slice(0, 3).map((item) => item.name),
    ].slice(0, 5);
    return toKnowledgeNotFound(parsed.q, suggestions);
  }

  const answer =
    rankedReference.length >= rankedSounds.length
      ? formatReferenceAnswer(rankedReference, parsed.q)
      : formatSoundsAnswer(rankedSounds, parsed.q);

  return toKnowledgeSuccess(parsed.q, parsed.domain, answer, rankedReference, rankedSounds);
}
