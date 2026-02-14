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

function collectPlaceholders(input: string): string[] {
  const matches = input.match(/{{\s*[A-Z0-9_]+\s*}}/g) ?? [];
  return [...new Set(matches.map((m) => m.replace(/[{}\s]/g, '')))];
}

function renderTemplate(template: string, vars: PromptVars): string {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_, key: keyof PromptVars) => vars[key] ?? `{{${key}}}`);
}

async function loadTemplateTextBrowser(filename: string): Promise<string> {
  const url = new URL(`./templates/${filename}`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load prompt template ${filename}: ${response.status}`);
  }
  return (await response.text()).trim();
}

async function loadTemplateTextNode(filename: string, templatesDir?: string): Promise<string> {
  const [{ readFile }, pathModule, urlModule] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
    import('node:url'),
  ]);

  const currentDir = urlModule.fileURLToPath(new URL('.', import.meta.url));
  const resolvedDir = templatesDir ?? pathModule.join(currentDir, 'templates');
  return (await readFile(pathModule.join(resolvedDir, filename), 'utf8')).trim();
}

async function loadTemplateText(filename: string, templatesDir?: string): Promise<string> {
  if (typeof window === 'undefined') {
    return loadTemplateTextNode(filename, templatesDir);
  }
  return loadTemplateTextBrowser(filename);
}

export async function buildSystemPrompt(options: BuildPromptOptions): Promise<PromptBuildResult> {
  const parts = await Promise.all(TEMPLATE_FILENAMES.map((filename) => loadTemplateText(filename, options.templatesDir)));

  const raw = parts.join('\n\n');
  const rendered = renderTemplate(raw, options.vars).trim();
  const unresolved = collectPlaceholders(rendered);

  return {
    prompt: rendered,
    unresolvedPlaceholders: unresolved,
  };
}
