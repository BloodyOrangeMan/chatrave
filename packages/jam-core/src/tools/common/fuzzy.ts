export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[b.length];
}

export function scoreCandidate(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);

  if (!q || !c) return 0;

  let score = 0;
  if (q === c) {
    score += 220;
  } else if (c.startsWith(q)) {
    score += 150;
  } else if (c.includes(q)) {
    score += 100;
  }

  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  const overlap = qTokens.filter((token) => cTokens.includes(token)).length;
  const overlapRatio = qTokens.length > 0 ? overlap / qTokens.length : 0;
  score += Math.round(overlapRatio * 60);

  const editDistance = levenshtein(q, c);
  const maxLen = Math.max(q.length, c.length);
  const similarity = maxLen > 0 ? 1 - editDistance / maxLen : 0;
  score += Math.max(0, Math.round(similarity * 80));

  const lengthPenalty = Math.max(0, Math.abs(c.length - q.length) - 3);
  score -= Math.min(20, lengthPenalty * 2);

  return Math.max(0, score);
}
