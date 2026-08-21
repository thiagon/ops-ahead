import { useEffect, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { fetchAlertDailyFeatures, fetchRecurringPatterns } from '~/clickhouse.server.ts';
import { DrillDown } from '~/components/DrillDown';
import { type Kpi, KpiCard } from '~/components/KpiCard';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RecommendationCard } from '~/components/RecommendationCard';
import type { TimelineEvent } from '~/components/Timeline';
import { loadQueue, type QueueRow } from '~/queue.server.ts';
import { formatRatio } from '~/risk.ts';
import type { Route } from './+types/painel';
import type { loader as detailLoader } from './occurrence-detail';

export function meta() {
  return [{ title: 'Painel N1/N2 · Ops Ahead' }];
}

function criticality(row: QueueRow): number {
  const score = row.breach_probability ?? 0;
  return (6 - row.severity) * 10 + row.consumed_ratio * 5 + score * 3;
}

export async function loader() {
  const [queue, dailyFeatures, recurringPatterns] = await Promise.all([
    loadQueue(),
    fetchAlertDailyFeatures().catch(() => []),
    fetchRecurringPatterns().catch(() => []),
  ]);

  const rows = [...queue].sort((a, b) => criticality(b) - criticality(a));
  const latestDay = [...dailyFeatures].sort((a, b) => b.date.localeCompare(a.date))[0];

  return { rows, latestDay, recurringPatterns };
}

function buildKpis(
  rows: QueueRow[],
  latestDay: Route.ComponentProps['loaderData']['latestDay'],
): Kpi[] {
  const critical = rows.filter(r => r.severity <= 2).length;
  const scored = rows.filter(r => r.breach_probability !== null);
  const avgScore =
    scored.length > 0
      ? scored.reduce((sum, r) => sum + (r.breach_probability ?? 0), 0) / scored.length
      : null;

  const kpis: Kpi[] = [
    {
      label: 'Incidentes ativos',
      value: String(rows.length),
      tone: rows.length > 0 ? 'red' : 'green',
      icon: 'alert-circle',
    },
    {
      label: 'Críticos (P1+P2)',
      value: String(critical),
      tone: critical > 0 ? 'amber' : 'green',
      icon: 'alert-triangle',
    },
  ];

  if (avgScore !== null) {
    kpis.push({
      label: 'Score médio de risco',
      value: formatRatio(avgScore),
      tone: avgScore >= 0.6 ? 'red' : avgScore >= 0.35 ? 'amber' : 'green',
      icon: 'trending-up',
    });
  }

  if (latestDay) {
    kpis.push({
      label: `Sem intervenção (${latestDay.date})`,
      value: formatRatio(latestDay.no_intervention_share),
      delta: `${latestDay.total_incidents} incidentes no dia`,
      tone: latestDay.no_intervention_share >= 0.3 ? 'amber' : 'blue',
      icon: 'clock',
    });
  }

  return kpis;
}

export default function Painel({ loaderData }: Route.ComponentProps) {
  const { rows, latestDay, recurringPatterns } = loaderData;
  const first = rows[0];
  const [selectedKey, setSelectedKey] = useState(
    first ? `${first.source}/${first.external_id}` : undefined,
  );
  const selected = rows.find(r => `${r.source}/${r.external_id}` === selectedKey) ?? first;

  const detailFetcher = useFetcher<typeof detailLoader>();
  const detailLoad = detailFetcher.load;

  useEffect(() => {
    if (selected) {
      detailLoad(`/ocorrencias/${selected.source}/${selected.external_id}/detalhe`);
    }
  }, [selected, detailLoad]);

  const timeline: TimelineEvent[] = detailFetcher.data?.timeline ?? [];
  const similarIncidents = detailFetcher.data?.similarIncidents ?? [];

  const kpis = buildKpis(rows, latestDay);

  return (
    <main className="flex flex-col px-8 py-6">
      <PageHeader
        title="Painel N1/N2"
        subtitle="Fila de ocorrências ordenada por criticidade, com o motivo por trás de cada score."
        action={
          <Link to="/painel-gestor" className="text-sm text-text-muted hover:text-text-light">
            Painel do gestor →
          </Link>
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
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-sm text-text-light">
              Ocorrências ativas
              <span className="rounded-full bg-accent-red/15 px-2 py-0.5 font-bold text-accent-red text-xs">
                {rows.length}
              </span>
            </h2>
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-border-base bg-bg-tile p-4 text-text-muted text-sm">
              Nenhuma ocorrência aberta no momento.
            </p>
          ) : (
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
          )}
        </div>

        <div>
          {selected && (
            <DrillDown row={selected} timeline={timeline} similarIncidents={similarIncidents} />
          )}
        </div>
      </div>

      {recurringPatterns.length > 0 && (
        <Panel title="Padrões recorrentes (últimos 30 dias)" className="mt-6">
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
