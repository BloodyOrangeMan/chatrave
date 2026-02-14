import type { ApplyStrudelChangeInput } from '../contracts';

export interface ApplyValidationResult {
  ok: boolean;
  nextCode?: string;
  diagnostics?: string[];
}

export function validateApplyChange(input: ApplyStrudelChangeInput): ApplyValidationResult {
  if (input.change.kind === 'full_code') {
    if (!input.change.content.trim()) {
      return { ok: false, diagnostics: ['Full code cannot be empty'] };
    }
    return { ok: true, nextCode: input.change.content };
  }

  if (!input.change.content.trim()) {
    return { ok: false, diagnostics: ['Patch content cannot be empty'] };
  }

  // Phase 3 placeholder: patch is appended as conservative fallback.
  return { ok: true, nextCode: `${input.currentCode}\n${input.change.content}` };
}
