# Deployment Guide

This project is designed to run as a static web app with no backend required.

## Deployment Model

- `agent-web` runs in the browser.
- Strudel UI/runtime runs in the browser.
- Tools (`read_code`, `apply_strudel_change`, `strudel_knowledge`, `skill`) run locally in browser runtime.
- External network dependency is OpenRouter API calls when real mode is enabled.

## Skills and Filesystem Note

Skills do not depend on runtime filesystem access in production.

- Skill markdown files are imported with Vite raw imports:
  - `apps/agent-web/src/skills/catalog.ts`
  - `import ... from './*/SKILL.md?raw'`
- This bundles skill content into the built app.
- Static hosting works without Node `fs` APIs at runtime.

## Prerequisites

- `node >= 20`
- `pnpm 10.4.1`

Install dependencies:

```bash
pnpm install
pnpm -C strudel install
```

## Build Commands

From repo root:

```bash
pnpm run build             # builds agent module, stages assets, generates doc.json, builds strudel website
```

Outputs:
- Agent bundle: `apps/agent-web/dist/`
- Staged agent assets: `strudel/website/public/chatrave-agent/`
- Production site: `strudel/website/dist/`

## Vercel (Recommended)

This repo is configured for a single Vercel project serving Strudel at `/`.

1. Import repo in Vercel.
2. Keep root directory as repo root.
3. Build command: `pnpm run build`
4. Output directory: `strudel/website/dist`
5. Install command: `pnpm install && pnpm -C strudel install`

If you see an error like:

`Could not resolve "../../../doc.json" from "src/docs/JsDoc.jsx"`

it means `strudel/doc.json` was not generated in the build environment. `build` runs `pnpm -C strudel jsdoc-json` before website build to prevent this.

`vercel.json` already contains these defaults.

Production agent loading behavior:
- tries same-origin module first: `/chatrave-agent/agent-tab.js`
- no localhost fallback URLs in production or dev runtime.

## Static Hosting

Deploy static assets from the relevant `dist` directories to your static host.

Common options:

- Cloudflare Pages
- Netlify
- Vercel static output

## Runtime Configuration

- OpenRouter API key is user-provided in Agent Settings UI and stored in browser localStorage.
- No project API key is required for static deployment.
- Voice provider keys (if used) are also set in UI and stored locally.

## Production Smoke Checklist

After deploy:

1. Strudel page loads and audio controls work.
2. Agent tab loads inside side panel.
3. In mock mode, skill list/get works (e.g. `jazz`, `techno`, `house`).
4. In real mode, OpenRouter requests work with user-provided key.
5. Apply tool rejects invalid code and schedules valid code.
6. Tool logs and markdown rendering display correctly.

## Optional Future Backend Mode

A backend proxy is optional and not required for this static-first deployment.
If added later, it should be an additive mode (not replacing current user-key flow).
