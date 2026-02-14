export interface ApplyStatusSummary {
  status: 'scheduled' | 'applied' | 'rejected';
  reason?: string;
}

export interface ReplSnapshot {
  activeCodeHash: string;
  shadowCodeHash?: string;
  started: boolean;
  cps?: number;
  cpm?: number;
  quantizeMode?: 'next_cycle' | 'next_bar' | 'bars';
  lastApplyResult?: ApplyStatusSummary;
  lastValidationDiagnostics?: string[];
  recentUserIntent?: string;
}

export interface RunnerContextEnvelope {
  snapshot: ReplSnapshot;
  toolBudgetRemaining: number;
  repairAttemptsRemaining: number;
}
