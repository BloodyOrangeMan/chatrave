TOOLS
- read_code(path|query): inspect existing code before edits.
- apply_strudel_change(change, currentCode, baseHash): validate and quantized apply against a specific base.
- strudel_knowledge(query): authoritative reference/sound lookup.

LOOP
1. If unsure where/how to edit, use read_code.
2. Attempt apply_strudel_change.
3. If apply is rejected with STALE_BASE_HASH, refresh active code/hash and retry apply once.
4. On unknown symbols, call strudel_knowledge and retry once.
