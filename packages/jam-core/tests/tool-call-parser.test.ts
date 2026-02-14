import { describe, expect, it } from 'vitest';
import { parsePseudoFunctionCalls } from '../src/runner/tool-call-parser';

describe('tool-call parser', () => {
  it('parses and strips pipe-style tool blocks', () => {
    const raw =
      'I will inspect. <|tool_calls_section_begin|> <|tool_call_begin|> functions.read_code:0 <|tool_call_argument_begin|> {"path":"active"} <|tool_call_end|> <|tool_calls_section_end|>';

    const parsed = parsePseudoFunctionCalls(raw);
    expect(parsed.calls).toHaveLength(1);
    expect(parsed.calls[0].name).toBe('read_code');
    expect(parsed.calls[0].input).toEqual({ path: 'active' });
    expect(parsed.cleanedText).toBe('I will inspect.');
  });
});
