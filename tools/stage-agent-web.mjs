#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const srcDir = resolve(root, 'apps/agent-web/dist');
const destDir = resolve(root, 'strudel/website/public/chatrave-agent');

if (!existsSync(srcDir)) {
  console.error(`Missing agent-web build output at ${srcDir}`);
  console.error('Run: pnpm run build:agent-web');
  process.exit(1);
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });
cpSync(srcDir, destDir, { recursive: true });

console.log(`[chatrave][stage-agent-web] copied ${srcDir} -> ${destDir}`);
