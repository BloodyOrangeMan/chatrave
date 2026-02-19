const THINKING_PREVIEW_MAX_CHARS = 220;

export function getThinkingPreview(text: string, maxChars = THINKING_PREVIEW_MAX_CHARS): string {
  const source = (text ?? '').trim();
  if (!source) return '';
  if (source.length <= maxChars) return source;
  return `...${source.slice(source.length - maxChars).replace(/^\s+/, '')}`;
}

