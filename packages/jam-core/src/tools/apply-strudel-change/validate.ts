import type { ApplyStrudelChangeInput } from '../contracts';

export interface ApplyValidationResult {
  ok: boolean;
  diagnostics?: string[];
}

export function validateApplyChange(input: ApplyStrudelChangeInput): ApplyValidationResult {
  if (!input.baseHash || !input.baseHash.trim()) {
    return { ok: false, diagnostics: ['baseHash is required'] };
  }
  if (input.change.kind === 'full_code') {
    if (!input.change.content.trim()) {
      return { ok: false, diagnostics: ['Full code cannot be empty'] };
    }
    return { ok: true };
  }

  if (!input.change.content.trim()) {
    return { ok: false, diagnostics: ['Patch content cannot be empty'] };
  }
  return { ok: true };
}
