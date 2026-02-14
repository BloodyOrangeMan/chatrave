import type { ApplyStrudelChangeInput } from '../contracts';
import { scheduleApply } from './schedule';
import { toApplyRejected, toApplyScheduled } from './result';
import { validateApplyChange } from './validate';

type ApplyResult = ReturnType<typeof toApplyScheduled> | ReturnType<typeof toApplyRejected>;

export interface ApplyExecutionContext {
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<{ status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }>;
}

export async function executeApplyStrudelChange(
  input: ApplyStrudelChangeInput,
  context: ApplyExecutionContext = {},
): Promise<ApplyResult> {
  const validated = validateApplyChange(input);
  if (!validated.ok) {
    const diagnostics = validated.diagnostics ?? ['Unknown validation failure'];
    const phase = diagnostics.some((item) => item.includes('STALE_BASE_HASH')) ? 'STALE_BASE_HASH' : 'validate';
    return toApplyRejected(phase, diagnostics, []);
  }

  if (context.applyStrudelChange) {
    try {
      const result = await context.applyStrudelChange(input);
      return toApplyScheduled(result.applyAt ?? new Date().toISOString());
    } catch (error) {
      return toApplyRejected('execute', [(error as Error).message], []);
    }
  }

  const schedule = scheduleApply(input.policy?.quantize ?? 'next_cycle');
  return toApplyScheduled(schedule.applyAt);
}
