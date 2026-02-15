export function toApplyScheduled(applyAt: string) {
  return {
    status: 'scheduled' as const,
    applyAt,
    activeUnchangedUntilApply: true,
  };
}

export function toApplyRejected(phase: string, diagnostics: string[], unknownSymbols?: string[]) {
  const payload: {
    status: 'rejected';
    phase: string;
    diagnostics: string[];
    unknownSymbols?: string[];
  } = {
    status: 'rejected' as const,
    phase,
    diagnostics,
  };
  if (Array.isArray(unknownSymbols) && unknownSymbols.length > 0) {
    payload.unknownSymbols = unknownSymbols;
  }
  return payload;
}
