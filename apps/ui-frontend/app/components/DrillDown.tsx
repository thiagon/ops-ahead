import { Badge, severityTone } from '~/components/Badge';
import { ChevronRightIcon, InfoIcon } from '~/components/icons';
import { Panel } from '~/components/Panel';
import { Timeline, type TimelineEvent } from '~/components/Timeline';
import {
  formatRatio,
  formatRemaining,
  riskColor,
  SEVERITY_LABEL,
  suggestedAction,
} from '~/risk.ts';
import type { BreachSignals, QueueRow, SimilarIncidentRow } from '~/types.ts';

function openedAgo(openedAt: string): string {
  const openedMs = new Date(`${openedAt.replace(' ', 'T')}Z`).getTime();
  const totalMinutes = Math.max(0, Math.floor((Date.now() - openedMs) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${totalMinutes % 60}min`;
  return `${totalMinutes}min`;
}

const SIGNAL_LABEL: Record<keyof BreachSignals, string> = {
  group_load: 'ocorrências abertas no grupo agora',
  entity_signal_count_15m: 'sinais de monitor na entidade (15min)',
  entity_signal_count_1h: 'sinais de monitor na entidade (1h)',
  entity_auto_resolution_rate: 'taxa de auto-resolução da entidade',
  entity_severity_escalations: 'escaladas de severidade na entidade',
  group_severity_historical_ola_ratio: 'histórico de OLA do grupo nesta severidade',
  no_intervention_count_1h: '"sem intervenção" no grupo (1h)',
  no_intervention_count_6h: '"sem intervenção" no grupo (6h)',
  p4_precursor_length: 'sequência de P4 antes da abertura',
};

function formatSignalValue(key: keyof BreachSignals, value: number): string {
  if (key === 'entity_auto_resolution_rate' || key === 'group_severity_historical_ola_ratio') {
    return formatRatio(value);
  }
  return String(value);
}

/**
 * The three sources the breach context is assembled from, named the way the
 * operator talks about them — never the mart that answered the query.
 */
const SIGNAL_GROUPS: Array<{
  label: string;
  keys: Array<keyof BreachSignals>;
}> = [
  {
    label: 'Recurso',
    keys: ['entity_signal_count_15m', 'entity_signal_count_1h', 'entity_severity_escalations'],
  },
  {
    label: 'Grupo',
    keys: ['group_load', 'no_intervention_count_1h', 'no_intervention_count_6h'],
  },
  {
    label: 'Histórico',
    keys: [
      'group_severity_historical_ola_ratio',
      'entity_auto_resolution_rate',
      'p4_precursor_length',
    ],
  },
];

function BreachSignalsGrid({ signals }: { signals: BreachSignals | null }) {
  if (!signals) {
    return (
      <p className="text-text-muted text-sm">
        Sem contexto de risco calculado para esta ocorrência.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {SIGNAL_GROUPS.map(group => (
        <div
          key={group.label}
          className="flex items-start justify-between gap-2 rounded-lg border border-border-base p-3 text-xs"
        >
          <div className="min-w-0">
            <div className="font-semibold text-text-light">{group.label}</div>
            <ul className="mt-1.5 space-y-1 text-text-muted">
              {group.keys.map(key => {
                const value = signals[key];
                return (
                  <li key={key}>
                    {SIGNAL_LABEL[key]}:{' '}
                    <span className="font-semibold text-text-light">
                      {value === null ? 'sem histórico' : formatSignalValue(key, value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <ChevronRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
        </div>
      ))}
    </div>
  );
}

function SimilarIncidentsList({ rows }: { rows: SimilarIncidentRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-text-muted text-sm">
        Nenhuma ocorrência fechada recente com a mesma severidade e grupo.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border-base rounded-lg border border-border-base">
      {rows.map(row => (
        <li
          key={`${row.source}/${row.external_id}`}
          className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="truncate text-sm text-text-light">{row.title || row.external_id}</p>
            <p className="text-text-dim text-xs">
              {row.external_id} · {row.owner || 'sem grupo'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            <span className="text-text-muted">{formatRemaining(row.duration_seconds)}</span>
            {row.has_breached ? <Badge tone="red">estourou</Badge> : <Badge tone="green">no prazo</Badge>}
          </div>
        </li>
      ))}
    </ul>
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
        <div className="flex flex-wrap items-center gap-2 text-text-muted text-xs">
          <span>
            {row.external_id} · {row.entity_id || row.source}
          </span>
          <Badge tone={severityTone(row.severity)}>
            SEVERIDADE {row.severity} ({SEVERITY_LABEL[row.severity] ?? row.severity})
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-text-muted text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-red" />
          Aberto há {openedAgo(row.opened_at)}
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg text-text-light">{row.title}</h2>
          <p className="mt-1.5 max-w-lg text-sm text-text-muted">
            {suggestedAction(row.severity, row.consumed_ratio)} — regra por severidade e prazo
            consumido, não recomendação de copiloto.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled
            title="Depende do copiloto — o agente de decisão ainda não existe"
            className="cursor-not-allowed rounded-lg bg-accent-red/40 px-3.5 py-2.5 font-semibold text-white text-xs"
          >
            Ack &amp; Aplicar
          </button>
          <button
            type="button"
            disabled
            title="Depende do copiloto — o agente de decisão ainda não existe"
            className="cursor-not-allowed rounded-lg border border-border-base px-3.5 py-2.5 font-semibold text-text-dim text-xs"
          >
            Ignorar (motivo)
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div
          className="rounded-lg border px-3.5 py-2.5 font-bold text-sm"
          style={{ color, borderColor: color, backgroundColor: `${color}1a` }}
        >
          {row.breach_probability !== null
            ? `score breach ${row.breach_probability.toFixed(2)}`
            : `prazo consumido ${formatRatio(row.consumed_ratio)}`}
        </div>
        <div className="text-sm text-text-muted">
          janela OLA: {row.has_breached ? 'expirada' : formatRemaining(row.time_remaining_seconds)}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-text-muted text-xs uppercase tracking-wide">
            SHAP — top 5 fatores
            <span title="Contribuição de cada fator para o score deste caso">
              <InfoIcon className="h-3.5 w-3.5" />
            </span>
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
              Score indisponível para esta ocorrência.
            </p>
          )}
        </div>

        <Timeline events={timeline} />
      </div>

      <div>
        <h3 className="mb-3 text-text-muted text-xs uppercase tracking-wide">
          Sinais considerados no score
        </h3>
        <BreachSignalsGrid signals={row.breach_signals} />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-text-muted text-xs uppercase tracking-wide">
            Ocorrências similares (mesma severidade e grupo, já fechadas)
          </h3>
          {similarIncidents.length > 0 && (
            <span className="text-text-muted text-xs">{similarIncidents.length} encontradas</span>
          )}
        </div>
        <SimilarIncidentsList rows={similarIncidents} />
      </div>
    </Panel>
  );
}
