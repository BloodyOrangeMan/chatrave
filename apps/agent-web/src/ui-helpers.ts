export interface ToolLogPayload {
  id: string;
  name: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  request?: unknown;
  response?: unknown;
  errorMessage?: string;
}

const REDACT_KEYS = ['apikey', 'api_key', 'authorization', 'token', 'secret', 'password', 'credential', 'cookie'];

function shouldRedactKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACT_KEYS.some((needle) => lower.includes(needle));
}

function redactString(value: string): string {
  if (/^Bearer\s+/i.test(value)) {
    return 'Bearer •••';
  }
  if (value.length > 80 && /[A-Za-z0-9_-]{24,}/.test(value)) {
    return '•••';
  }
  return value;
}

export function sanitizeForLog(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeForLog(item));
  }
  if (!input || typeof input !== 'object') {
    return typeof input === 'string' ? redactString(input) : input;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (shouldRedactKey(key)) {
      output[key] = '•••';
    } else {
      output[key] = sanitizeForLog(value);
    }
  }
  return output;
}

export function formatJsonBlock(input: unknown): string {
  try {
    return JSON.stringify(sanitizeForLog(input), null, 2);
  } catch {
    return String(input);
  }
}

function appendTextWithInlineCode(root: HTMLElement, text: string): void {
  if (!text) {
    return;
  }
  const parts = text.split(/(`[^`]+`)/g);
  for (const part of parts) {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = document.createElement('code');
      code.textContent = part.slice(1, -1);
      root.append(code);
      continue;
    }
    root.append(document.createTextNode(part));
  }
}

function appendParagraph(container: HTMLElement, chunk: string): void {
  const p = document.createElement('p');
  p.className = 'agent-md-paragraph';
  const lines = chunk.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const segments = line.split(/(https?:\/\/[^\s]+)/g);
    for (const segment of segments) {
      if (!segment) {
        continue;
      }
      if (/^https?:\/\//.test(segment)) {
        const a = document.createElement('a');
        a.href = segment;
        a.textContent = segment;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        p.append(a);
      } else {
        appendTextWithInlineCode(p, segment);
      }
    }
    if (i < lines.length - 1) {
      p.append(document.createElement('br'));
    }
  }
  container.append(p);
}

function createCodeBlock(language: string, content: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'agent-code-block';

  const header = document.createElement('div');
  header.className = 'agent-code-header';

  const label = document.createElement('span');
  label.textContent = language || 'code';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'agent-quiet-button';
  copy.textContent = 'Copy';
  copy.onclick = async () => {
    await navigator.clipboard.writeText(content);
    copy.textContent = 'Copied';
    setTimeout(() => {
      copy.textContent = 'Copy';
    }, 1200);
  };

  header.append(label, copy);

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = content;
  pre.append(code);

  wrap.append(header, pre);
  return wrap;
}

export function renderMarkdownLike(container: HTMLElement, text: string): void {
  container.innerHTML = '';
  const fence = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    const language = (match[1] || '').trim();
    const code = match[2] || '';

    if (before.trim()) {
      for (const paragraph of before.split(/\n\n+/)) {
        if (paragraph.trim()) {
          appendParagraph(container, paragraph.trim());
        }
      }
    }

    container.append(createCodeBlock(language, code.trimEnd()));
    cursor = match.index + match[0].length;
  }

  const rest = text.slice(cursor);
  if (rest.trim()) {
    for (const paragraph of rest.split(/\n\n+/)) {
      if (paragraph.trim()) {
        appendParagraph(container, paragraph.trim());
      }
    }
  }
}
