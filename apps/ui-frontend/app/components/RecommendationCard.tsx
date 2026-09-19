import { Badge, severityTone } from '~/components/Badge';
import {
  formatRatio,
  formatRemaining,
  riskColor,
  SEVERITY_LABEL,
  suggestedActionShort,
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-text-muted text-xs">
            {row.external_id} · {row.entity_id || row.source}
          </div>
          <div className="mt-2 truncate font-semibold text-sm text-text-light">{row.title}</div>
          <div className="mt-1 truncate text-text-muted text-xs">
            {row.owner || 'sem owner'} · {suggestedActionShort(row.severity, row.consumed_ratio)}
            {!row.acknowledged && ' · não reconhecida'}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={severityTone(row.severity)}>
            {SEVERITY_LABEL[row.severity] ?? row.severity}
          </Badge>
          {score !== null && (
            <span
              className="rounded-md border px-2.5 py-1 font-bold text-sm"
              style={{ color, borderColor: color, backgroundColor: `${color}1a` }}
            >
              {formatRatio(score)}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 text-right text-text-muted text-xs">
        {formatRemaining(row.time_remaining_seconds)}
      </div>
    </button>
  );
}
