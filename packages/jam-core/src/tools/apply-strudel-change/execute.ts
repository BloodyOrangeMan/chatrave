import type { ApplyStrudelChangeInput } from '../contracts';
import { scheduleApply } from './schedule';
import { toApplyRejected, toApplyScheduled } from './result';
import { validateApplyChange } from './validate';

type ApplyResult = ReturnType<typeof toApplyScheduled> | ReturnType<typeof toApplyRejected>;

export function executeApplyStrudelChange(input: ApplyStrudelChangeInput): ApplyResult {
  const validated = validateApplyChange(input);
  if (!validated.ok) {
    return toApplyRejected('validate', validated.diagnostics ?? ['Unknown validation failure'], []);
  }

  const schedule = scheduleApply(input.policy?.quantize ?? 'next_cycle');
  return toApplyScheduled(schedule.applyAt);
}
