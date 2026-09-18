export function nextDraftId(): string {
  return crypto.randomUUID();
}

export function iconButtonClass(danger = false): string {
  return danger
    ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-accent-red/10 hover:text-accent-red'
    : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-white/[0.04] hover:text-text-light';
}

export function dashedAddClass(): string {
  return 'flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-border-base border-dashed px-3 py-2 text-sm text-text-dim transition-colors hover:border-signal-blue/50 hover:text-text-light';
}
