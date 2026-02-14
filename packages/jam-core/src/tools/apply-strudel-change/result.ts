export function toApplyScheduled(applyAt: string) {
  return {
    status: 'scheduled' as const,
    applyAt,
    activeUnchangedUntilApply: true,
  };
}

export function toApplyRejected(phase: string, diagnostics: string[], unknownSymbols: string[]) {
  return {
    status: 'rejected' as const,
    phase,
    diagnostics,
    unknownSymbols,
  };
}
