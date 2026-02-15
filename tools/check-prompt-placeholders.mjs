#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const templatesDir = join(process.cwd(), 'packages/agent-core/src/prompts/templates');
const allowed = new Set(['MAX_REPAIR_ATTEMPTS', 'GLOBAL_TOOL_BUDGET']);

let files = [];
try {
  files = readdirSync(templatesDir).filter((file) => file.endsWith('.md'));
} catch {
  console.log('No prompt template directory found. Skipping placeholder validation.');
  process.exit(0);
}
const placeholderPattern = /{{\s*([A-Z0-9_]+)\s*}}/g;

let bad = false;
for (const file of files) {
  const text = readFileSync(join(templatesDir, file), 'utf8');
  const matches = [...text.matchAll(placeholderPattern)];
  for (const match of matches) {
    const key = match[1];
    if (!allowed.has(key)) {
      console.error(`Unknown prompt placeholder ${key} in ${file}`);
      bad = true;
    }
  }
}

if (bad) {
  process.exit(1);
}

console.log('Prompt placeholders validated.');
