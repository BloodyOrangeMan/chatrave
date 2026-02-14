# CLAUDE.md — Offline Strudel Jam Agent (In-Browser)

## Goal
Build an **offline-first, in-browser Strudel REPL website** that supports a **real-time “jamming” workflow**: the user speaks or types commands while music loops continuously, and an agent safely modifies Strudel code without breaking rhythm. The only online dependency is the **LLM API call** (user provides API key in the UI). Everything else (Strudel engine, validation, skills registry, chat history) runs locally in the browser.

> Important: The website must be **based on original Strudel open-source code** (embedded Strudel engine/packages), not a reimplementation.

---

## Key UX Requirements

### Real-Time Jamming Workflow
- Music loops continuously.
- User interacts via **text chat** and **voice** (STT).
- The agent proposes changes without crashing or desyncing audio.

### Shadow Evaluation + Quantized Injection (App-Owned)
- Agent-generated code is applied via an app-managed **shadow buffer** (never directly to active playback).
- The app performs a fast **DRY RUN** validation: evaluate code into a Pattern and query a short span (e.g., 0.5–1 bar) **without touching live audio output**.
- If DRY RUN succeeds, the app schedules a **quantized swap** on the next musical boundary (“the One”) for seamless DJ-style transitions.
- If DRY RUN fails, the app returns **structured diagnostics**; the agent repairs and retries.

### Expert Agent (Anti-Hallucination, Responsive)
Many LLMs invent fake Strudel features. To keep the app responsive:
- The agent **first attempts code** using a conservative supported subset.
- Only when an error occurs (unknown symbols / validation failures) does the agent consult a **single consolidated knowledge tool**.
- **Deprecated doc/capability tools are removed** (no multi-step `get_strudel_capabilities/search/read` flow).

### Chat UI with Explicit Tool Calls
- Chat interface similar to ChatGPT.
- Offline chat history (no server-side required).
- The UI must explicitly show:
  - each tool call the agent makes (name + args)
  - tool results (success/diagnostics)
  - scheduling markers (e.g., “Queued for next cycle”, “Applied at bar N”)

### Skills Mechanic (Modular Expertise, Offline)
Agent “personas” and domain knowledge are loaded dynamically from a filesystem-like registry:
- Skills stored in `.strudel/skills/<skillname>/`
- Each skill contains:
  - `SKILL.md` (rules + examples)
  - `skill.json` (tags/triggers/metadata)
  - optional snippets (e.g., `templates.strudel`, `patterns.json`)
- When user says “make it jazzy,” the system loads the skill and injects rules/snippets into the agent context.
- Skills must work offline (OPFS + bundled default skill packs).

---

## Architecture Overview (Browser-Only)

### Main Components
1. **Strudel Engine**
   - Embedded from original Strudel packages (e.g., `@strudel/web` or `@strudel/repl`).
   - Must support programmatic updates without restarting the audio context.

2. **Quantized Scheduler (App-Owned)**
   - The app controls quantized transitions (next bar/cycle/N bars).
   - The agent does not need to poll transport state for routine operations.
   - The app reports when a change will land as part of the apply tool result.

3. **Buffers**
   - `active` code: currently playing.
   - `shadow` code: candidate code pending validation.
   - `pendingSwap`: queued swap metadata (when + what).

4. **Validator (DRY RUN)**
   - Single primary gate:
     - evaluate shadow code into a Pattern
     - query Pattern for a short span with tight timeouts
     - never touch live audio output during validation
   - Returns structured diagnostics:
     - `phase`: `syntax | compile | runtime | timeout`
     - `unknownSymbols` (critical for anti-hallucination)
     - line/col when possible

5. **Agent Runner (Web Worker)**
   - Runs the minimal tool-calling loop to the LLM API.
   - Calls a single primary tool to apply changes.
   - On error, consults the knowledge tool and retries (bounded attempts).
   - Streams tool-call events to the UI for transparency.

6. **Perception (Voice)**
   - MVP: Web Speech API (interim + final transcripts).
   - Optional: Offline Whisper WASM mode as an upgrade.

7. **Offline Persistence**
   - IndexedDB: chat sessions, tool logs, snapshots, preferences.
   - OPFS: skills registry and optional user packs.

---

## Critical Safety Invariants
- **Never** apply agent-generated code directly to active playback.
- All edits must go through the **single apply tool**, which performs DRY RUN validation.
- If validation fails:
  - keep current audio playing
  - return diagnostics to the agent
  - require a repair + retry
- Quantized transitions are handled by the app (swap on the One).
- Bounded retries and timeouts to keep the UI responsive.

---

## Tooling Contract (Agent ↔ App)

### Primary Apply Tool (Minimal Round-Trips)
#### `apply_strudel_change(change, policy)`
Single tool call that:
1) updates shadow (full code or patch),
2) runs DRY RUN validation,
3) if valid, schedules a quantized swap + updates REPL,
4) if invalid, rejects with structured diagnostics and unknownSymbols.

**Input (conceptual)**
- `change`: `{ type: "full_code"|"patch", code?: string, patch?: string, format?: "unified_diff"|"edits" }`
- `policy`: `{ quantize: "next_cycle"|"next_bar"|"bars", bars?: number, autoStartIfStopped?: boolean, dryRunBars?: number, fadeMs?: number }`

**Output**
- Success: `{ status: "scheduled"|"applied", applyAt: {...}, activeUnchangedUntilApply: true }`
- Failure: `{ status: "rejected", phase: "...", diagnostics: [...], unknownSymbols: [...], suggestedNext?: {...} }`

> The agent should aim to do everything with `apply_strudel_change` to reduce latency.

### Knowledge Tool (Only On Error/Uncertainty)
#### `strudel_knowledge(query)`
Single consolidated knowledge tool backed by a **bundled docs snapshot + symbol table**. Returns authoritative usage + minimal examples.

**Important**
- Remove deprecated tools:
  - ❌ `get_strudel_capabilities`
  - ❌ `search_strudel_docs`
  - ❌ `read_strudel_doc`
- Use only `strudel_knowledge(query)`.

### Skills Tools (Optional)
You may implement as tools or automatic app-side injection:
- `activate_skills(tags|names)` → returns skill snippets/rules to inject into context
- (Optional) `skills_list()` for browsing in UI

---

## Agent Behavior Rules (Aligned with Minimal Tools)
1. First attempt: generate Strudel code conservatively.
2. Call `apply_strudel_change` (default quantize = next_cycle).
3. If rejected:
   - read diagnostics + unknownSymbols
   - call `strudel_knowledge` with targeted queries
   - revise and call `apply_strudel_change` again
4. Keep retries bounded; if still failing, propose a simpler safe change.
5. The assistant response must state:
   - what changed
   - that it will land on the next quantized boundary (the app handles timing)
   - any important constraint respected (e.g., “kept drums unchanged”)

---

## Offline Implementation Notes

### Bundled Knowledge
- Pin a Strudel docs/version snapshot at build time.
- Build a lightweight symbol table and examples for `strudel_knowledge`.
- Ship this with the app for offline use.

### Skills Storage
- Default skills bundled.
- Users can import/export skill packs; store in OPFS under `.strudel/skills/`.

### Chat History
- Persist sessions locally with IndexedDB.
- Store tool call events and code snapshots for timeline playback/revert.

---

## Deliverables
- Offline-first web app (PWA optional)
- Embedded Strudel engine from original code
- Minimal agent loop (browser) calling LLM API
- Single-call apply pipeline with DRY RUN validation + quantized swap
- Skills registry system (OPFS) + default skills
- Chat UI with explicit tool calls and offline history

---

## Non-Goals (for MVP)
- No server-side infrastructure.
- No multi-user collaboration.
- No background jobs beyond the current browser tab.
- No fine-tuning; expertise comes from skills + `strudel_knowledge` on-demand.
