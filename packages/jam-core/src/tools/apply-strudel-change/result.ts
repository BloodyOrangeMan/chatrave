export type ApplyRejectedErrorCode =
  | 'STALE_BASE_HASH'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_SOUND'
  | 'RUNTIME_EXECUTE_ERROR';

export function toApplyScheduled(applyAt: string) {
  return {
    status: 'scheduled' as const,
    applyAt,
    activeUnchangedUntilApply: true,
  };
}

export function toApplyRejected(
  phase: string,
  errorCode: ApplyRejectedErrorCode,
  diagnostics: string[],
  unknownSymbols?: string[],
  suggestedNext?: string,
  staleMeta?: { latestCode: string; latestHash: string; expectedBaseHash: string },
) {
  const payload: {
    status: 'rejected';
    phase: string;
    errorCode: ApplyRejectedErrorCode;
    diagnostics: string[];
    unknownSymbols?: string[];
    suggestedNext?: string;
    latestCode?: string;
    latestHash?: string;
    expectedBaseHash?: string;
  } = {
    status: 'rejected' as const,
    phase,
    errorCode,
    diagnostics,
  };
  if (Array.isArray(unknownSymbols) && unknownSymbols.length > 0) {
    payload.unknownSymbols = unknownSymbols;
  }
  if (suggestedNext && suggestedNext.trim().length > 0) {
    payload.suggestedNext = suggestedNext.trim();
  }
  if (staleMeta) {
    payload.latestCode = staleMeta.latestCode;
    payload.latestHash = staleMeta.latestHash;
    payload.expectedBaseHash = staleMeta.expectedBaseHash;
  }
  return payload;
}
