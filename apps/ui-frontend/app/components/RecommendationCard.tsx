import { Badge, severityTone } from '~/components/Badge';
import {
  formatRatio,
  formatRemaining,
  riskColor,
  SEVERITY_LABEL,
  suggestedAction,
} from '~/risk.ts';
import type { QueueRow } from '~/types.ts';

export function RecommendationCard({
  row,
  active,
  onClick,
}: {
  row: QueueRow;
  active: boolean;
  onClick: () => void;
}) {
  const color = riskColor(row.consumed_ratio);
  const score = row.breach_probability;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border bg-bg-tile p-4 text-left transition-colors ${
        active
          ? 'border-accent-red/60 bg-white/[0.03]'
          : 'border-border-base hover:border-signal-blue/40'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-text-muted text-xs">
          {row.external_id} · {row.owner || '—'}
        </span>
        <Badge tone={severityTone(row.severity)}>
          {SEVERITY_LABEL[row.severity] ?? row.severity}
        </Badge>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-sm text-text-light">{row.title}</div>
          <div className="mt-1 truncate text-text-muted text-xs">
            {suggestedAction(row.severity, row.consumed_ratio)}
          </div>
        </div>
        {score !== null && (
          <span
            className="shrink-0 rounded-md border px-2.5 py-1 font-mono font-bold text-sm"
            style={{ color, borderColor: color, backgroundColor: `${color}1a` }}
          >
            {formatRatio(score)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-text-muted text-xs">
        <span>{row.acknowledged ? 'reconhecida' : 'não reconhecida'}</span>
        <span className="font-mono" style={{ color }}>
          {formatRemaining(row.time_remaining_seconds)}
        </span>
      </div>
    </button>
  );
}
