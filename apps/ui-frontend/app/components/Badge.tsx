export type BadgeTone = 'red' | 'amber' | 'blue' | 'green' | 'neutral';

const toneClasses: Record<BadgeTone, string> = {
  red: 'bg-accent-red/15 text-accent-red border-accent-red/40',
  amber: 'bg-signal-amber/15 text-signal-amber border-signal-amber/40',
  blue: 'bg-signal-blue/15 text-signal-blue border-signal-blue/40',
  green: 'bg-signal-green/15 text-signal-green border-signal-green/40',
  neutral: 'bg-bg-elevated text-text-muted border-border-base',
};

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

export function severityTone(severity: number): BadgeTone {
  if (severity <= 2) return 'red';
  if (severity === 3) return 'amber';
  if (severity === 4) return 'blue';
  return 'neutral';
}
