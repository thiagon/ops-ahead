import { useEffect, useState } from 'react';
import { Link, useFetcher, useNavigate, useNavigation, useSearchParams } from 'react-router';
import type { AlertDailyFeatureRow } from '~/clickhouse.server.ts';
import { fetchAlertDailyFeatures, fetchRecurringPatterns } from '~/clickhouse.server.ts';
import { DrillDown } from '~/components/DrillDown';
import { CalendarIcon, RefreshIcon } from '~/components/icons';
import { type Kpi, KpiCard } from '~/components/KpiCard';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RecommendationCard } from '~/components/RecommendationCard';
import { RouteError } from '~/components/RouteError';
import type { TimelineEvent } from '~/components/Timeline';
import { withTenant } from '~/features/config/repo.server.ts';
import { managerPath, occurrenceDetailPath, queuePath, useTenantSlug } from '~/paths';
import { loadQueue, type QueueRow } from '~/queue.server.ts';
import { formatRatio } from '~/risk.ts';
import type { Route } from './+types/panel';
import type { loader as detailLoader } from './occurrence-detail';

export function meta() {
  return [{ title: 'Painel N1/N2 · Ops Ahead' }];
}

function criticality(row: QueueRow): number {
  const score = row.breach_probability ?? 0;
  return (6 - row.severity) * 10 + row.consumed_ratio * 5 + score * 3;
}

const SORTS = {
  criticidade: {
    label: 'Criticidade',
    compare: (a: QueueRow, b: QueueRow) => criticality(b) - criticality(a),
  },
  prazo: {
    label: 'Prazo mais curto',
    compare: (a: QueueRow, b: QueueRow) => a.time_remaining_seconds - b.time_remaining_seconds,
  },
  recentes: {
    label: 'Mais recentes',
    compare: (a: QueueRow, b: QueueRow) => b.opened_at.localeCompare(a.opened_at),
  },
  risco: {
    label: 'Maior risco',
    compare: (a: QueueRow, b: QueueRow) =>
      (b.breach_probability ?? -1) - (a.breach_probability ?? -1),
  },
} as const;

type SortKey = keyof typeof SORTS;

export const PERIODS = [7, 14, 30] as const;
const DEFAULT_PERIOD = 14;

export function parsePeriod(value: string | null): number {
  const days = Number(value);
  return PERIODS.includes(days as (typeof PERIODS)[number]) ? days : DEFAULT_PERIOD;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return withTenant(request, params.tenant, async () => {
    const periodDays = parsePeriod(new URL(request.url).searchParams.get('period'));

    const [queue, dailyFeatures, recurringPatterns] = await Promise.all([
      loadQueue(),
      fetchAlertDailyFeatures(periodDays).catch(() => []),
      fetchRecurringPatterns(periodDays).catch(() => []),
    ]);

    const rows = [...queue].sort((a, b) => criticality(b) - criticality(a));

    return { rows, dailyFeatures, recurringPatterns, periodDays };
  });
}

/** One point per day, oldest first — `fetchAlertDailyFeatures` returns newest first. */
function dailySeries(dailyFeatures: AlertDailyFeatureRow[]): AlertDailyFeatureRow[] {
  const byDate = new Map<string, AlertDailyFeatureRow>();
  for (const row of dailyFeatures) {
    const acc = byDate.get(row.date);
    byDate.set(
      row.date,
      acc
        ? {
            ...acc,
            total_incidents: acc.total_incidents + row.total_incidents,
            critical_share:
              (acc.critical_share * acc.total_incidents +
                row.critical_share * row.total_incidents) /
              (acc.total_incidents + row.total_incidents || 1),
            median_duration_seconds: acc.median_duration_seconds ?? row.median_duration_seconds,
          }
        : row,
    );
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function pctDelta(series: number[]): string | undefined {
  if (series.length < 2) return undefined;
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || last === undefined) return undefined;
  const pct = Math.round(((last - first) / first) * 100);
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}% vs início do período`;
}

function buildKpis(rows: QueueRow[], dailyFeatures: AlertDailyFeatureRow[]): Kpi[] {
  const critical = rows.filter(r => r.severity <= 2).length;
  const scored = rows.filter(r => r.breach_probability !== null);
  const avgScore =
    scored.length > 0
      ? scored.reduce((sum, r) => sum + (r.breach_probability ?? 0), 0) / scored.length
      : null;

  const series = dailySeries(dailyFeatures);
  const dates = series.map(d => d.date);
  const incidentsSeries = series.map(d => d.total_incidents);
  const criticalSeries = series.map(d => d.total_incidents * d.critical_share);
  // The mart leaves median_duration_seconds null on days where nothing closed.
  const withDuration = series.flatMap(d =>
    d.median_duration_seconds === null
      ? []
      : [{ date: d.date, hours: d.median_duration_seconds / 3600 }],
  );
  const durationSeries = withDuration.map(d => d.hours);
  const durationDates = withDuration.map(d => d.date);
  const latestDuration = withDuration.at(-1);

  const kpis: Kpi[] = [
    {
      label: 'Incidentes ativos',
      value: String(rows.length),
      delta: pctDelta(incidentsSeries),
      tone: rows.length > 0 ? 'red' : 'green',
      icon: 'alert-circle',
      sparkline: incidentsSeries.length > 1 ? incidentsSeries : undefined,
      sparklineLabels: dates,
      sparklineFormat: v => `${Math.round(v)} incidentes`,
    },
    {
      label: 'Críticos (P1+P2)',
      value: String(critical),
      delta: pctDelta(criticalSeries),
      tone: critical > 0 ? 'amber' : 'green',
      icon: 'alert-triangle',
      sparkline: criticalSeries.length > 1 ? criticalSeries : undefined,
      sparklineLabels: dates,
      sparklineFormat: v => `${Math.round(v)} críticos`,
    },
  ];

  kpis.push({
    label: 'Score médio de risco',
    value: avgScore !== null ? formatRatio(avgScore) : '—',
    delta: avgScore === null ? 'score indisponível' : undefined,
    tone:
      avgScore === null ? 'blue' : avgScore >= 0.6 ? 'red' : avgScore >= 0.35 ? 'amber' : 'green',
    icon: 'trending-up',
  });

  kpis.push({
    label: 'Duração mediana (h)',
    value: latestDuration ? latestDuration.hours.toFixed(1) : '—',
    delta: latestDuration ? pctDelta(durationSeries) : 'sem fechamento no período',
    tone: 'blue',
    icon: 'clock',
    sparkline: durationSeries.length > 1 ? durationSeries : undefined,
    sparklineLabels: durationDates,
    sparklineFormat: v => `${v.toFixed(1)}h`,
  });

  return kpis;
}

export default function Painel({ loaderData }: Route.ComponentProps) {
  const { rows: loadedRows, dailyFeatures, recurringPatterns, periodDays } = loaderData;
  const tenant = useTenantSlug();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>('criticidade');
  const ranked = [...loadedRows].sort(SORTS[sortKey].compare);
  // The panel is a briefing, not the full queue — only the most critical
  // stay as cards; the rest lives on /queue, which is built to scroll.
  const rows = ranked.slice(0, 8);
  const first = rows[0];
  const [selectedKey, setSelectedKey] = useState(
    first ? `${first.source}/${first.external_id}` : undefined,
  );
  const selected = rows.find(r => `${r.source}/${r.external_id}` === selectedKey) ?? first;

  const detailFetcher = useFetcher<typeof detailLoader>();
  const detailLoad = detailFetcher.load;

  useEffect(() => {
    if (selected) {
      detailLoad(occurrenceDetailPath(tenant, selected.source, selected.external_id));
    }
  }, [selected, detailLoad, tenant]);

  const timeline: TimelineEvent[] = detailFetcher.data?.timeline ?? [];
  const similarIncidents = detailFetcher.data?.similarIncidents ?? [];

  const kpis = buildKpis(loadedRows, dailyFeatures);
  const navigate = useNavigate();
  const navigation = useNavigation();
  const refreshing = navigation.state !== 'idle';

  return (
    <main className="flex flex-col px-4 py-6 sm:px-8">
      <PageHeader
        title="Painel N1/N2"
        subtitle="Fila de ocorrências ordenada por criticidade, com o motivo por trás de cada score."
        action={
          <>
            <Link
              to={managerPath(tenant)}
              className="text-sm text-text-muted hover:text-text-light"
            >
              Painel do gestor →
            </Link>
            <label className="flex items-center gap-2 rounded-lg border border-border-base bg-bg-tile px-3.5 py-2.5 text-sm text-text-muted focus-within:border-signal-blue/40">
              <CalendarIcon className="h-4 w-4" />
              <select
                value={periodDays}
                onChange={e => {
                  searchParams.set('period', e.target.value);
                  setSearchParams(searchParams, { replace: true });
                }}
                className="cursor-pointer bg-transparent text-text-light outline-none"
              >
                {PERIODS.map(days => (
                  <option key={days} value={days} className="bg-bg-tile">
                    Últimos {days} dias
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => navigate('.', { replace: true })}
              disabled={refreshing}
              className="flex items-center gap-2 rounded-lg bg-accent-red px-3.5 py-2.5 font-semibold text-sm text-white hover:bg-accent-red/90 disabled:opacity-60"
            >
              <RefreshIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
          </>
        }
      />

      {kpis.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map(kpi => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </div>
      )}

      <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold text-sm text-text-light">
              Ativas
              <span className="rounded-full bg-accent-red/15 px-2 py-0.5 font-bold text-accent-red text-xs">
                {loadedRows.length}
              </span>
            </h2>
            <label className="flex min-w-0 items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1.5 text-text-muted text-xs focus-within:border-signal-blue/40">
              Ordenar:
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="cursor-pointer bg-transparent text-text-light outline-none"
              >
                {Object.entries(SORTS).map(([key, sort]) => (
                  <option key={key} value={key} className="bg-bg-tile">
                    {sort.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-border-base bg-bg-tile p-4 text-text-muted text-sm">
              Nenhuma ocorrência aberta no momento.
            </p>
          ) : (
            <>
              <div className="space-y-3">
                {rows.map(row => (
                  <RecommendationCard
                    key={`${row.source}/${row.external_id}`}
                    row={row}
                    active={row === selected}
                    onClick={() => setSelectedKey(`${row.source}/${row.external_id}`)}
                  />
                ))}
              </div>
              <Link
                to={queuePath(tenant)}
                className="mt-4 block w-full rounded-lg border border-border-base py-2.5 text-center font-semibold text-sm text-text-light hover:border-signal-blue/40"
              >
                {loadedRows.length > rows.length
                  ? `Ver as ${loadedRows.length} ocorrências`
                  : 'Ver todos os incidentes'}
              </Link>
            </>
          )}
        </div>

        <div>
          {selected && (
            <DrillDown row={selected} timeline={timeline} similarIncidents={similarIncidents} />
          )}
        </div>
      </div>

      {recurringPatterns.length > 0 && (
        <Panel title={`Padrões recorrentes (últimos ${periodDays} dias)`} className="mt-6">
          <p className="mb-4 text-sm text-text-muted">
            Mesma entidade, categoria e severidade aparecendo mais de uma vez — candidatos a causa
            raiz recorrente.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border-base">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-bg-elevated text-text-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3">Recurso</th>
                  <th className="px-4 py-3">Severidade</th>
                  <th className="px-4 py-3">Ocorrências</th>
                  <th className="px-4 py-3">Estouros</th>
                </tr>
              </thead>
              <tbody>
                {recurringPatterns.map(p => (
                  <tr
                    key={`${p.category}-${p.product}-${p.entity_id}-${p.severity}`}
                    className="border-border-base border-t"
                  >
                    <td className="px-4 py-3 text-text-light">{p.category || '—'}</td>
                    <td className="px-4 py-3 text-text-muted">{p.product || '—'}</td>
                    <td className="px-4 py-3 font-mono text-text-light">{p.entity_id}</td>
                    <td className="px-4 py-3 text-text-muted">{p.severity}</td>
                    <td className="px-4 py-3 font-mono text-text-light">{p.incident_count}</td>
                    <td className="px-4 py-3 font-mono text-accent-red">{p.breached}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Painel N1/N2" service="O painel" />;
}
