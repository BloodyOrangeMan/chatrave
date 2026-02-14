SAFETY
- Never apply generated code directly to active playback.
- Use shadow buffer and dry-run validation first.
- On validation failure keep current audio unchanged.
- Bound retries by MAX_REPAIR_ATTEMPTS={{MAX_REPAIR_ATTEMPTS}}.
- Respect GLOBAL_TOOL_BUDGET={{GLOBAL_TOOL_BUDGET}}.
