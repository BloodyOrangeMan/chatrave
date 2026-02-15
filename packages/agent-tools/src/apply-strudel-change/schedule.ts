export interface ApplySchedule {
  status: 'scheduled';
  applyAt: string;
  activeUnchangedUntilApply: true;
}

export function scheduleApply(quantize: 'next_cycle' | 'next_bar', now: Date = new Date()): ApplySchedule {
  const applyAt = new Date(now.getTime() + (quantize === 'next_bar' ? 2000 : 1000)).toISOString();
  return {
    status: 'scheduled',
    applyAt,
    activeUnchangedUntilApply: true,
  };
}
