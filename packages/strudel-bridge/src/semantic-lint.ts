export interface SemanticLintResult {
  ok: boolean;
  diagnostics: string[];
}

const PARAM_METHODS = new Set([
  'lpf',
  'hpf',
  'bpf',
  'lpq',
  'hpq',
  'gain',
  'room',
  'decay',
  'attack',
  'release',
  'pan',
  'cutoff',
  'resonance',
  'delay',
  'delaytime',
]);

const SAFE_IDENTIFIERS = new Set([
  'Math',
  'Infinity',
  'NaN',
  'Number',
  'parseFloat',
  'parseInt',
  'isFinite',
  'isNaN',
]);

function collectDeclaredIdentifiers(code: string): Set<string> {
  const declared = new Set<string>();

  const varRegex = /\b(?:const|let|var)\s+([A-Za-z_]\w*)/g;
  let varMatch: RegExpExecArray | null;
  while ((varMatch = varRegex.exec(code)) !== null) {
    declared.add(varMatch[1]);
  }

  const fnRegex = /\bfunction\s+([A-Za-z_]\w*)\s*\(/g;
  let fnMatch: RegExpExecArray | null;
  while ((fnMatch = fnRegex.exec(code)) !== null) {
    declared.add(fnMatch[1]);
  }

  return declared;
}

function extractParenContent(input: string, openParenIndex: number): { content: string; endIndex: number } | null {
  if (input[openParenIndex] !== '(') return null;
  let depth = 0;
  let inQuote: string | null = null;

  for (let index = openParenIndex; index < input.length; index += 1) {
    const char = input[index];
    const prev = input[index - 1];

    if (inQuote) {
      if (char === inQuote && prev !== '\\') inQuote = null;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inQuote = char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: input.slice(openParenIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }

  return null;
}

function findMethodCallArgs(code: string): Array<{ method: string; argument: string }> {
  const found: Array<{ method: string; argument: string }> = [];
  const methodRegex = /\.([A-Za-z_]\w*)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = methodRegex.exec(code)) !== null) {
    const method = match[1];
    if (!PARAM_METHODS.has(method)) continue;

    const openParen = code.indexOf('(', match.index);
    if (openParen < 0) continue;
    const extracted = extractParenContent(code, openParen);
    if (!extracted) continue;

    found.push({ method, argument: extracted.content });
    methodRegex.lastIndex = extracted.endIndex + 1;
  }

  return found;
}

function findUnresolvedIdentifiers(expression: string, declared: Set<string>): string[] {
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const identifierRegex = /\b[A-Za-z_]\w*\b/g;
  let match: RegExpExecArray | null;

  while ((match = identifierRegex.exec(expression)) !== null) {
    const id = match[0];
    const start = match.index;
    const prev = expression[start - 1];
    if (prev === '.') continue;
    if (declared.has(id) || SAFE_IDENTIFIERS.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    unresolved.push(id);
  }

  return unresolved;
}

function lintChordVoicingSymbols(code: string): string[] {
  const diagnostics: string[] = [];
  const chordVoicingRegex = /chord\s*\(\s*(["'`])([\s\S]*?)\1\s*\)\s*\.voicing\s*\(\s*\)/g;
  let match: RegExpExecArray | null;

  while ((match = chordVoicingRegex.exec(code)) !== null) {
    const body = match[2] ?? '';
    const tokens = body
      .replace(/[<>|,]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const token of tokens) {
      if (/^[A-Ga-g][#b]?[0-8][A-Za-z#b]/.test(token)) {
        diagnostics.push(
          `INVALID_CHORD_VOICING_SYMBOL: "${token}" in chord().voicing(); use octave-free symbols like Cm7, G7, BbM7.`,
        );
      }
    }
  }

  return diagnostics;
}

function lintNonFiniteParamRisk(code: string): string[] {
  const diagnostics: string[] = [];
  const declared = collectDeclaredIdentifiers(code);
  const calls = findMethodCallArgs(code);

  for (const call of calls) {
    const unresolved = findUnresolvedIdentifiers(call.argument, declared);
    for (const id of unresolved) {
      diagnostics.push(`NON_FINITE_PARAM_RISK: unresolved identifier "${id}" in ${call.method}(...).`);
    }
  }

  return diagnostics;
}

export function lintStrudelSemantics(code: string): SemanticLintResult {
  const diagnostics = [...lintChordVoicingSymbols(code), ...lintNonFiniteParamRisk(code)];
  return { ok: diagnostics.length === 0, diagnostics };
}
