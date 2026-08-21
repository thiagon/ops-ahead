import { Link } from 'react-router';
import type {
  CategoryTrendRow,
  GroupLoadRow,
  KpiAchievementRow,
  KpiProjectionRow,
} from '~/clickhouse.server.ts';
import { loadDashboard } from '~/dashboard.server.ts';
import type { Route } from './+types/dashboard';

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

function achievementColor(pct: number): string {
  if (pct >= 100) return 'var(--color-signal-green)';
  if (pct >= 75) return 'var(--color-signal-amber)';
  return 'var(--color-accent-red)';
}

function KpiAchievementCard({ rows, group }: { rows: KpiAchievementRow[]; group: string }) {
  const latest = rows.filter(row => row.kpi_group === group).at(-1);
  return (
    <div className="rounded-lg border border-border-base bg-bg-tile p-6">
      <h3 className="text-text-muted text-xs uppercase tracking-wide">
        {KPI_GROUP_LABEL[group] ?? group}
      </h3>
      {latest ? (
        <>
          <p
            className="mt-2 font-mono font-semibold text-3xl"
            style={{ color: achievementColor(latest.achievement_pct) }}
          >
            {latest.achievement_pct}%
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {latest.breached_ytd} violações acumuladas no ano
          </p>
        </>
      ) : (
        <p className="mt-2 text-text-dim">Sem dado ainda</p>
      )}
    </div>
  );
}

function KpiProjectionCard({ rows, group }: { rows: KpiProjectionRow[]; group: string }) {
  const row = rows.find(r => r.kpi_group === group);
  return (
    <div className="rounded-lg border border-border-base bg-bg-tile p-6">
      <h3 className="text-text-muted text-xs uppercase tracking-wide">
        Projeção de fechamento — {KPI_GROUP_LABEL[group] ?? group}
      </h3>
      {row ? (
        <>
          <p className="mt-2 font-mono font-semibold text-2xl text-text-light">
            {Math.round(row.median_breaches_ytd)} violações
          </p>
          <p className="mt-1 font-mono text-sm text-text-muted">
            faixa 80%: {Math.round(row.ci80_lower)}–{Math.round(row.ci80_upper)}
          </p>
          {row.p_within_target !== null && (
            <p className="mt-1 text-signal-blue text-sm">
              {Math.round(row.p_within_target * 100)}% de chance de ficar dentro da meta
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-text-dim">Sem projeção ainda</p>
      )}
    </div>
  );
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
    <section className="mt-8">
      <h2 className="font-semibold text-text-light text-xl">Previsão de volume</h2>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {[...byGroup.entries()].map(([group, groupRows]) => (
          <div key={group} className="rounded-lg border border-border-base bg-bg-tile p-6">
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
    </section>
  );
}

function CategoryTrendsTable({ rows }: { rows: CategoryTrendRow[] }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-text-light text-xl">Tendência por categoria e produto</h2>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border-base">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-bg-tile text-text-muted text-xs uppercase tracking-wide">
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
    </section>
  );
}

function GroupLoadSection({ rows }: { rows: GroupLoadRow[] }) {
  return (
    <section className="mt-8">
      <h2 className="font-semibold text-text-light text-xl">Carga por grupo</h2>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        {rows.map(row => (
          <div key={row.owner} className="rounded-lg border border-border-base bg-bg-tile p-4">
            <p className="text-text-muted text-xs uppercase tracking-wide">{row.owner || '—'}</p>
            <p className="mt-1 font-mono font-semibold text-2xl text-text-light">
              {row.incidents_open}
            </p>
          </div>
        ))}
      </div>
    </section>
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

  return (
    <main className="container mx-auto p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold text-3xl text-text-light">Painel do gestor</h1>
        <Link to="/fila" className="text-sm text-text-muted hover:text-text-light">
          Fila de ocorrências →
        </Link>
      </div>
      <p className="mt-2 text-text-muted">
        Fechamento do mês contra a meta anual, e o que vem pela frente.
      </p>

      <section className="mt-8">
        <h2 className="font-semibold text-text-light text-xl">Meta anual — realizado</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <KpiAchievementCard rows={kpiAchievement} group="p1_p2" />
          <KpiAchievementCard rows={kpiAchievement} group="p3" />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold text-text-light text-xl">Projeção de fechamento</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <KpiProjectionCard rows={kpiProjection} group="p1_p2" />
          <KpiProjectionCard rows={kpiProjection} group="p3" />
        </div>
      </section>

      <VolumeForecastSection rows={volumeForecast} />
      <CategoryTrendsTable rows={categoryTrends} />
      <GroupLoadSection rows={groupLoad} />

      <section className="mt-8">
        <h2 className="font-semibold text-text-light text-xl">Recursos mais ruidosos</h2>
        <ul className="mt-4 divide-y divide-border-base rounded-lg border border-border-base bg-bg-tile">
          {noisyEntities.length === 0 ? (
            <li className="p-4 text-text-muted">Nenhum sinal na última hora.</li>
          ) : (
            noisyEntities.map(entity => (
              <li key={entity.entity_id} className="flex justify-between p-4">
                <span className="font-mono text-text-light">{entity.entity_id}</span>
                <span className="font-mono text-text-muted">{entity.signal_count} sinais/h</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
