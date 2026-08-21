import { Badge, severityTone } from '~/components/Badge';
import { Panel } from '~/components/Panel';
import { Timeline, type TimelineEvent } from '~/components/Timeline';
import {
  formatRatio,
  formatRemaining,
  riskColor,
  SEVERITY_LABEL,
  suggestedAction,
} from '~/risk.ts';
import type { QueueRow, SimilarIncidentRow } from '~/types.ts';

function SimilarIncidentsTable({ rows }: { rows: SimilarIncidentRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        Nenhuma ocorrência fechada recente com a mesma severidade e grupo.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border-base">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-bg-elevated text-left text-text-muted">
            <th className="px-3 py-2 font-medium">Ocorrência</th>
            <th className="px-3 py-2 font-medium">Fechada em</th>
            <th className="px-3 py-2 font-medium">Duração</th>
            <th className="px-3 py-2 text-right font-medium">Estourou</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={`${row.source}/${row.external_id}`} className="border-border-base border-t">
              <td className="px-3 py-2 font-mono text-text-light">{row.external_id}</td>
              <td className="px-3 py-2 text-text-muted">{row.closed_at}</td>
              <td className="px-3 py-2 text-text-muted">{formatRemaining(row.duration_seconds)}</td>
              <td className="px-3 py-2 text-right">
                {row.has_breached ? <Badge tone="red">sim</Badge> : <Badge tone="green">não</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DrillDown({
  row,
  timeline,
  similarIncidents,
}: {
  row: QueueRow;
  timeline: TimelineEvent[];
  similarIncidents: SimilarIncidentRow[];
}) {
  const color = riskColor(row.consumed_ratio);
  const shap = row.shap_top5;
  const maxAbs = shap && shap.length > 0 ? Math.max(...shap.map(s => Math.abs(s.shap_value))) : 1;

  return (
    <Panel className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <span className="font-mono">
            {row.external_id} · {row.owner || '—'}
          </span>
          <Badge tone={severityTone(row.severity)}>
            {SEVERITY_LABEL[row.severity] ?? row.severity}
          </Badge>
        </div>
        <div className="text-text-muted text-xs">
          Restante:{' '}
          <span className="font-mono" style={{ color }}>
            {formatRemaining(row.time_remaining_seconds)}
          </span>
        </div>
      </div>

      <div>
        <h2 className="font-semibold text-lg text-text-light">{row.title}</h2>
        <p className="mt-1.5 text-sm text-text-muted">
          {suggestedAction(row.severity, row.consumed_ratio)} — regra por severidade e prazo
          consumido, não recomendação de copiloto.
        </p>
      </div>

      <div className="flex items-center gap-4">
        {row.breach_probability !== null && (
          <div
            className="rounded-lg border px-3.5 py-2.5 font-bold text-sm"
            style={{ color, borderColor: color, backgroundColor: `${color}1a` }}
          >
            risco de estouro {formatRatio(row.breach_probability)}
          </div>
        )}
        <div className="text-sm text-text-muted">
          prazo consumido: <span className="font-mono">{formatRatio(row.consumed_ratio)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-3 text-text-muted text-xs uppercase tracking-wide">
            SHAP — top 5 fatores
          </h3>
          {shap && shap.length > 0 ? (
            <div className="space-y-2">
              {shap.map(s => {
                const width = (Math.abs(s.shap_value) / maxAbs) * 100;
                const positive = s.shap_value >= 0;
                return (
                  <div key={s.feature} className="flex items-center gap-2 text-xs">
                    <span className="w-40 truncate text-text-muted" title={s.feature}>
                      {s.feature}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded bg-bg-elevated">
                      <div
                        className={`h-full ${positive ? 'bg-accent-red' : 'bg-signal-blue'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span
                      className={`w-14 text-right font-semibold ${positive ? 'text-accent-red' : 'text-signal-blue'}`}
                    >
                      {s.shap_value > 0 ? '+' : ''}
                      {s.shap_value.toFixed(3)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-text-muted text-sm">
              ml-model-serving não respondeu para esta ocorrência.
            </p>
          )}
        </div>

        <Timeline events={timeline} />
      </div>

      <div>
        <h3 className="mb-3 text-text-muted text-xs uppercase tracking-wide">
          Ocorrências similares (mesma severidade e grupo, já fechadas)
        </h3>
        <SimilarIncidentsTable rows={similarIncidents} />
      </div>

      <p className="text-text-dim text-xs">
        Ferramentas chamadas pelo copiloto: pendente — o agente de decisão ainda não existe.
      </p>
    </Panel>
  );
}
