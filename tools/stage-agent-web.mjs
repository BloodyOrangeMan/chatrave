#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const srcDir = resolve(root, 'apps/agent-web/dist');
const destDir = resolve(root, 'strudel/website/public/chatrave-agent');
const referenceSrc = resolve(root, 'strudel/doc.json');
const referenceDest = resolve(destDir, 'reference-doc.json');

if (!existsSync(srcDir)) {
  console.error(`Missing agent-web build output at ${srcDir}`);
  console.error('Run: pnpm --filter @chatrave/agent-web build');
  process.exit(1);
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });
cpSync(srcDir, destDir, { recursive: true });
if (!existsSync(referenceSrc)) {
  console.error(`Missing Strudel reference doc at ${referenceSrc}`);
  console.error('Run: pnpm -C strudel jsdoc-json');
  process.exit(1);
}
cpSync(referenceSrc, referenceDest);

console.log(`[chatrave][stage-agent-web] copied ${srcDir} -> ${destDir}`);
console.log(`[chatrave][stage-agent-web] copied ${referenceSrc} -> ${referenceDest}`);
