export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function scoreCandidate(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);

  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q)) return 80;
  if (c.includes(q)) return 60;

  const qTokens = q.split(' ');
  const cTokens = c.split(' ');
  const overlap = qTokens.filter((token) => cTokens.includes(token)).length;
  return overlap * 10;
}
