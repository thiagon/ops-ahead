import { Link } from 'react-router';
import type {
  CategoryTrendRow,
  GroupLoadRow,
  KpiAchievementRow,
  KpiProjectionRow,
} from '~/clickhouse.server.ts';
import { Badge } from '~/components/Badge';
import { type Kpi, KpiCard } from '~/components/KpiCard';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { loadDashboard } from '~/dashboard.server.ts';
import type { Route } from './+types/gestor';

export function meta() {
  return [{ title: 'Painel do gestor · Ops Ahead' }];
}

export async function loader() {
  return await loadDashboard();
}

const KPI_GROUP_LABEL: Record<string, string> = {
  p1_p2: 'P1 + P2',
  p3: 'P3',
};

function buildKpis(kpiAchievement: KpiAchievementRow[], kpiProjection: KpiProjectionRow[]): Kpi[] {
  const groups = ['p1_p2', 'p3'];
  const kpis: Kpi[] = [];

  for (const group of groups) {
    const achievementRows = kpiAchievement
      .filter(row => row.kpi_group === group)
      .sort((a, b) => a.year - b.year || a.month.localeCompare(b.month));
    const latest = achievementRows.at(-1);
    if (latest) {
      kpis.push({
        label: `Meta anual — ${KPI_GROUP_LABEL[group] ?? group}`,
        value: `${latest.achievement_pct}%`,
        delta: `${latest.breached_ytd} violações acumuladas no ano`,
        tone:
          latest.achievement_pct >= 100 ? 'green' : latest.achievement_pct >= 75 ? 'amber' : 'red',
        icon: 'alert-circle',
        sparkline:
          achievementRows.length > 1 ? achievementRows.map(r => r.achievement_pct) : undefined,
      });
    }

    const projection = kpiProjection.find(r => r.kpi_group === group);
    if (projection) {
      kpis.push({
        label: `Projeção — ${KPI_GROUP_LABEL[group] ?? group}`,
        value: `${Math.round(projection.median_breaches_ytd)} violações`,
        delta:
          projection.p_within_target !== null
            ? `${Math.round(projection.p_within_target * 100)}% de chance de ficar dentro da meta`
            : `faixa 80%: ${Math.round(projection.ci80_lower)}–${Math.round(projection.ci80_upper)}`,
        tone: 'blue',
        icon: 'trending-up',
      });
    }
  }

  return kpis;
}

function VolumeForecastSection({
  rows,
}: {
  rows: Route.ComponentProps['loaderData']['volumeForecast'];
}) {
  const byGroup = new Map<string, typeof rows>();
  for (const row of rows) {
    byGroup.set(row.priority_group, [...(byGroup.get(row.priority_group) ?? []), row]);
  }

  return (
    <Panel title="Previsão de volume" className="mt-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...byGroup.entries()].map(([group, groupRows]) => (
          <div key={group} className="rounded-lg border border-border-base bg-bg-elevated p-4">
            <h3 className="text-text-muted text-xs uppercase tracking-wide">
              {KPI_GROUP_LABEL[group] ?? group}
            </h3>
            <div className="mt-3 flex gap-8">
              {groupRows
                .sort((a, b) => a.horizon - b.horizon)
                .map(row => (
                  <div key={row.horizon}>
                    <p className="text-text-dim text-xs">D+{row.horizon}</p>
                    <p className="font-mono font-semibold text-text-light text-xl">
                      {Math.round(row.yhat)}
                    </p>
                    <p className="font-mono text-text-dim text-xs">
                      {Math.round(row.yhat_lower)}–{Math.round(row.yhat_upper)}
                    </p>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CategoryTrendsTable({ rows }: { rows: CategoryTrendRow[] }) {
  return (
    <Panel title="Tendência por categoria e produto" className="mt-6">
      <div className="overflow-x-auto rounded-lg border border-border-base">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-bg-elevated text-text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">P1</th>
              <th className="px-4 py-3">P2</th>
              <th className="px-4 py-3">P3</th>
              <th className="px-4 py-3">P4</th>
              <th className="px-4 py-3">P5</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map(row => (
              <tr
                key={`${row.date}-${row.category}-${row.product}`}
                className="border-border-base border-t"
              >
                <td className="px-4 py-3 text-text-light">{row.category || '—'}</td>
                <td className="px-4 py-3 text-text-muted">{row.product || '—'}</td>
                <td className="px-4 py-3 font-mono text-text-light">{row.total_incidents}</td>
                <td className="px-4 py-3 font-mono text-accent-red">{row.p1_count}</td>
                <td className="px-4 py-3 font-mono text-signal-amber">{row.p2_count}</td>
                <td className="px-4 py-3 font-mono text-signal-amber">{row.p3_count}</td>
                <td className="px-4 py-3 font-mono text-text-muted">{row.p4_count}</td>
                <td className="px-4 py-3 font-mono text-text-dim">{row.p5_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function GroupLoadSection({ rows }: { rows: GroupLoadRow[] }) {
  return (
    <Panel title="Carga por grupo" className="mt-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {rows.map(row => (
          <div key={row.owner} className="rounded-lg border border-border-base bg-bg-elevated p-4">
            <p className="text-text-muted text-xs uppercase tracking-wide">{row.owner || '—'}</p>
            <p className="mt-1 font-mono font-semibold text-2xl text-text-light">
              {row.incidents_open}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    kpiAchievement,
    kpiProjection,
    volumeForecast,
    categoryTrends,
    groupLoad,
    noisyEntities,
  } = loaderData;

  const kpis = buildKpis(kpiAchievement, kpiProjection);

  return (
    <main className="px-8 py-6">
      <PageHeader
        title="Painel do gestor"
        subtitle="Fechamento do mês contra a meta anual, e o que vem pela frente."
        action={
          <Link to="/fila" className="text-sm text-text-muted hover:text-text-light">
            Fila de ocorrências →
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

      <VolumeForecastSection rows={volumeForecast} />
      <CategoryTrendsTable rows={categoryTrends} />
      <GroupLoadSection rows={groupLoad} />

      <Panel title="Recursos mais ruidosos" className="mt-6">
        <ul className="divide-y divide-border-base rounded-lg border border-border-base">
          {noisyEntities.length === 0 ? (
            <li className="p-4 text-text-muted">Nenhum sinal na última hora.</li>
          ) : (
            noisyEntities.map(entity => (
              <li key={entity.entity_id} className="flex justify-between p-4">
                <span className="font-mono text-text-light">{entity.entity_id}</span>
                <Badge tone="amber">{entity.signal_count} sinais/h</Badge>
              </li>
            ))
          )}
        </ul>
      </Panel>
    </main>
  );
}
