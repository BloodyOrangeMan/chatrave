import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_FILENAMES = [
  'system.base.md',
  'system.safety.md',
  'system.tools.md',
  'system.music.md',
  'system.style.md',
] as const;

export interface PromptVars {
  MAX_REPAIR_ATTEMPTS: string;
  GLOBAL_TOOL_BUDGET: string;
}

export interface BuildPromptOptions {
  vars: PromptVars;
  templatesDir?: string;
}

export interface PromptBuildResult {
  prompt: string;
  unresolvedPlaceholders: string[];
}

function defaultTemplatesDir(): string {
  const current = fileURLToPath(new URL('.', import.meta.url));
  return join(current, 'templates');
}

function collectPlaceholders(input: string): string[] {
  const matches = input.match(/{{\s*[A-Z0-9_]+\s*}}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[{}\s]/g, '')))];
}

function renderTemplate(template: string, vars: PromptVars): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_, key: keyof PromptVars) => vars[key] ?? `{{${key}}}`);
}

export function buildSystemPrompt(options: BuildPromptOptions): PromptBuildResult {
  const templatesDir = options.templatesDir ?? defaultTemplatesDir();
  const raw = TEMPLATE_FILENAMES
    .map((filename) => readFileSync(join(templatesDir, filename), 'utf8').trim())
    .join('\n\n');

  const rendered = renderTemplate(raw, options.vars).trim();
  const unresolved = collectPlaceholders(rendered);

  return {
    prompt: rendered,
    unresolvedPlaceholders: unresolved,
  };
}
