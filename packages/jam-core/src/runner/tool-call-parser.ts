import type { ToolCall, ToolName } from '../tools/contracts';

const TOOL_NAMES: ToolName[] = ['read_code', 'apply_strudel_change', 'strudel_knowledge'];

function toToolName(input: string): ToolName | null {
  return TOOL_NAMES.includes(input as ToolName) ? (input as ToolName) : null;
}

export interface ToolParseResult {
  calls: ToolCall[];
  cleanedText: string;
}

function parseXmlLikeCalls(raw: string): ToolCall[] {
  const invokePattern = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  const parameterPattern = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;

  const calls: ToolCall[] = [];
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(raw)) !== null) {
    const toolName = toToolName(invokeMatch[1]);
    if (!toolName) continue;

    const input: Record<string, string> = {};
    let parameterMatch: RegExpExecArray | null;
    while ((parameterMatch = parameterPattern.exec(invokeMatch[2])) !== null) {
      input[parameterMatch[1]] = parameterMatch[2].trim();
    }

    calls.push({
      id: `tool-${Date.now()}-${calls.length}`,
      name: toolName,
      input,
    });
  }
  return calls;
}

function parsePipeStyleCalls(raw: string): ToolCall[] {
  const invokePattern =
    /<\|tool_call_begin\|>\s*functions\.([a-z_]+):\d+\s*<\|tool_call_argument_begin\|>\s*({[\s\S]*?})\s*<\|tool_call_end\|>/g;

  const calls: ToolCall[] = [];
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokePattern.exec(raw)) !== null) {
    const toolName = toToolName(invokeMatch[1]);
    if (!toolName) continue;

    let input: unknown = {};
    try {
      input = JSON.parse(invokeMatch[2]);
    } catch {
      input = {};
    }

    calls.push({
      id: `tool-${Date.now()}-${calls.length}`,
      name: toolName,
      input,
    });
  }
  return calls;
}

export function parsePseudoFunctionCalls(raw: string): ToolParseResult {
  const xmlBlockPattern = /<function_calls>[\s\S]*?<\/function_calls>/g;
  const pipeBlockPattern = /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/g;
  const orphanPipeTokensPattern = /<\|tool_call(?:s)?_[^|]+?\|>/g;

  const calls = [...parseXmlLikeCalls(raw), ...parsePipeStyleCalls(raw)];
  const cleanedText = raw
    .replace(xmlBlockPattern, '')
    .replace(pipeBlockPattern, '')
    .replace(orphanPipeTokensPattern, '')
    .trim();

  return { calls, cleanedText };
}
