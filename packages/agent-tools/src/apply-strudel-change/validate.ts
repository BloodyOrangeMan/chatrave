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

  if (!input.change.search || input.change.search.length === 0) {
    return { ok: false, diagnostics: ['search_replace.search is required'] };
  }
  if (typeof input.change.replace !== 'string') {
    return { ok: false, diagnostics: ['search_replace.replace must be a string'] };
  }
  if (
    input.change.occurrence !== undefined &&
    input.change.occurrence !== 'single' &&
    input.change.occurrence !== 'all'
  ) {
    return { ok: false, diagnostics: ['search_replace.occurrence must be "single" or "all"'] };
  }
  return { ok: true };
}
