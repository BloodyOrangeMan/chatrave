import type { ApplyStrudelChangeInput } from '../contracts';
import { scheduleApply } from './schedule';
import { toApplyRejected, toApplyScheduled } from './result';
import { validateApplyChange } from './validate';

type ApplyResult = ReturnType<typeof toApplyScheduled> | ReturnType<typeof toApplyRejected>;

export interface ApplyExecutionContext {
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<
    | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
    | { status: 'rejected'; phase?: string; diagnostics?: string[]; unknownSymbols?: string[] }
  >;
}

export async function executeApplyStrudelChange(
  input: ApplyStrudelChangeInput,
  context: ApplyExecutionContext = {},
): Promise<ApplyResult> {
  const validated = validateApplyChange(input);
  if (!validated.ok) {
    const diagnostics = validated.diagnostics ?? ['Unknown validation failure'];
    const isStaleHash = diagnostics.some((item) => item.includes('STALE_BASE_HASH'));
    return toApplyRejected(
      isStaleHash ? 'STALE_BASE_HASH' : 'validate',
      isStaleHash ? 'STALE_BASE_HASH' : 'VALIDATION_ERROR',
      diagnostics,
      [],
      isStaleHash ? 'Refresh code snapshot and retry with latest baseHash.' : 'Fix diagnostics and retry apply.',
    );
  }

  if (context.applyStrudelChange) {
    try {
      const result = await context.applyStrudelChange(input);
      if (result.status === 'rejected') {
        const diagnostics = result.diagnostics ?? ['apply rejected'];
        const unknownSymbols = result.unknownSymbols ?? [];
        const hasUnknownSound = unknownSymbols.length > 0;
        const phase = result.phase ?? 'validate';
        return toApplyRejected(
          phase,
          hasUnknownSound ? 'UNKNOWN_SOUND' : phase === 'STALE_BASE_HASH' ? 'STALE_BASE_HASH' : 'VALIDATION_ERROR',
          diagnostics,
          unknownSymbols,
          hasUnknownSound
            ? 'Use strudel_knowledge for the unknown symbol(s) and retry with known sounds.'
            : phase === 'STALE_BASE_HASH'
              ? 'Refresh code snapshot and retry with latest baseHash.'
              : 'Fix diagnostics and retry apply.',
        );
      }
      return toApplyScheduled(result.applyAt ?? new Date().toISOString());
    } catch (error) {
      return toApplyRejected(
        'execute',
        'RUNTIME_EXECUTE_ERROR',
        [(error as Error).message],
        [],
        'Keep current audio unchanged and retry with safer minimal change.',
      );
    }
  }

  const schedule = scheduleApply('next_cycle');
  return toApplyScheduled(schedule.applyAt);
}
