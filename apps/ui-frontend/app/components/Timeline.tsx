import { MILESTONE_LABEL, SEVERITY_LABEL } from '~/risk.ts';
import type { MilestoneRow, SeverityChangeRow } from '~/types.ts';

export interface TimelineEvent {
  at: string;
  label: string;
}

export function buildTimeline(
  milestones: MilestoneRow[],
  severityHistory: SeverityChangeRow[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...milestones.map(m => ({
      at: m.occurred_at,
      label: `${MILESTONE_LABEL[m.kind] ?? m.kind} — severidade ${SEVERITY_LABEL[m.severity] ?? m.severity}`,
    })),
    ...severityHistory.map(s => ({
      at: s.received_at,
      label: `${SEVERITY_LABEL[s.severity_from] ?? s.severity_from} → ${SEVERITY_LABEL[s.severity_to] ?? s.severity_to}`,
    })),
  ];
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-text-muted text-sm">Sem marcos registrados ainda.</p>;
  }

  return (
    <div>
      <h3 className="mb-3 text-text-muted text-xs uppercase tracking-wide">Linha do tempo</h3>
      <div className="space-y-0">
        {events.map((e, i) => (
          <div key={`${e.at}-${e.label}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent-red" />
              {i < events.length - 1 && <span className="w-px flex-1 bg-border-base" />}
            </div>
            <div className="min-w-0 pb-4">
              <div className="text-[11px] text-text-dim">{e.at}</div>
              <div className="text-text-light text-xs">{e.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
