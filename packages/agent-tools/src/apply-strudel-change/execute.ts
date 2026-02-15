import type { ApplyStrudelChangeInput } from '../contracts';
import { scheduleApply } from './schedule';
import { toApplyRejected, toApplyScheduled } from './result';
import { validateApplyChange } from './validate';
import type { ReadCodeInput } from '../contracts';

type ApplyResult = ReturnType<typeof toApplyScheduled> | ReturnType<typeof toApplyRejected>;

export interface ApplyExecutionContext {
  readCode?: (input: ReadCodeInput) => Promise<unknown>;
  applyStrudelChange?: (
    input: ApplyStrudelChangeInput,
  ) => Promise<
    | { status: 'scheduled' | 'applied'; applyAt?: string; diagnostics?: string[] }
    | {
        status: 'rejected';
        phase?: string;
        diagnostics?: string[];
        unknownSymbols?: string[];
        latestCode?: string;
        latestHash?: string;
        expectedBaseHash?: string;
      }
  >;
}

export async function executeApplyStrudelChange(
  input: ApplyStrudelChangeInput,
  context: ApplyExecutionContext = {},
): Promise<ApplyResult> {
  const validated = validateApplyChange(input);
  if (!validated.ok) {
    const diagnostics = validated.diagnostics ?? ['Unknown validation failure'];
    return toApplyRejected(
      'validate',
      'VALIDATION_ERROR',
      diagnostics,
      undefined,
      'Fix diagnostics and retry apply.',
    );
  }

  if (context.readCode) {
    const snapshot = await context.readCode({ path: 'active' });
    if (snapshot && typeof snapshot === 'object') {
      const maybe = snapshot as { code?: unknown; hash?: unknown };
      if (typeof maybe.code === 'string' && typeof maybe.hash === 'string' && input.baseHash !== maybe.hash) {
        return toApplyRejected(
          'STALE_BASE_HASH',
          'STALE_BASE_HASH',
          [`STALE_BASE_HASH: expected ${input.baseHash} but active hash is ${maybe.hash}`],
          undefined,
          'Retry apply using latestHash/latestCode from this response.',
          { latestCode: maybe.code, latestHash: maybe.hash, expectedBaseHash: input.baseHash },
        );
      }
    }
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
              ? 'Retry apply using latestHash/latestCode from this response.'
              : 'Fix diagnostics and retry apply.',
          phase === 'STALE_BASE_HASH' && result.latestCode && result.latestHash && result.expectedBaseHash
            ? {
                latestCode: result.latestCode,
                latestHash: result.latestHash,
                expectedBaseHash: result.expectedBaseHash,
              }
            : undefined,
        );
      }
      return toApplyScheduled(result.applyAt ?? new Date().toISOString());
    } catch (error) {
      return toApplyRejected(
        'execute',
        'RUNTIME_EXECUTE_ERROR',
        [(error as Error).message],
        undefined,
        'Keep current audio unchanged and retry with safer minimal change.',
      );
    }
  }

  const schedule = scheduleApply('next_cycle');
  return toApplyScheduled(schedule.applyAt);
}
