#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rootDir = process.cwd();
const docPath = join(rootDir, 'docs/DEV_FAKE_BOUNDARY.md');

function parseTrackedPaths(markdown) {
  const rows = markdown
    .split('\n')
    .filter((line) => line.startsWith('|') && line.includes('`') && !line.includes('| --- |'));

  const tracked = [];
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }
    const fileCell = cells[2] ?? '';
    const classCell = cells[3] ?? '';
    if (!classCell.includes('dev-only') && !classCell.includes('mixed')) {
      continue;
    }

    const match = fileCell.match(/`([^`]+)`/);
    if (!match) {
      continue;
    }

    const rawPath = match[1];
    if (rawPath.includes('(')) {
      continue;
    }
    tracked.push(rawPath);
  }
  return tracked;
}

const markdown = readFileSync(docPath, 'utf8');
const trackedPaths = parseTrackedPaths(markdown);

if (trackedPaths.length === 0) {
  console.error('No tracked dev/fake paths found in docs/DEV_FAKE_BOUNDARY.md');
  process.exit(1);
}

let hasMissing = false;
for (const path of trackedPaths) {
  const absolute = join(rootDir, path);
  if (!existsSync(absolute)) {
    console.error(`Missing tracked boundary path: ${path}`);
    hasMissing = true;
  }
}

if (hasMissing) {
  process.exit(1);
}

console.log(`Dev/fake boundary paths validated (${trackedPaths.length} entries).`);

