TOOLS
- read_code(path|query): inspect existing code before edits.
- apply_strudel_change(change, policy): validate and quantized apply.
- strudel_knowledge(query): authoritative reference/sound lookup.

LOOP
1. If unsure where/how to edit, use read_code.
2. Attempt apply_strudel_change.
3. On unknown symbols, call strudel_knowledge and retry once.
