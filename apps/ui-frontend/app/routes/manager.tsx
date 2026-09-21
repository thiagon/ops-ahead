import { Link } from 'react-router';
import type {
  CategoryTrendRow,
  EntityForecastRow,
  GroupLoadRow,
  KpiAchievementRow,
  KpiProjectionRow,
  RecurringCauseGroupRow,
} from '~/clickhouse.server.ts';
import { Badge } from '~/components/Badge';
import { ForecastChart } from '~/components/ForecastChart';
import { type Kpi, KpiCard } from '~/components/KpiCard';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import { loadDashboard } from '~/dashboard.server.ts';
import { withTenant } from '~/features/config/repo.server.ts';
import { queuePath, useTenantSlug } from '~/paths';
import type { Route } from './+types/manager';

export function meta() {
  return [{ title: 'Painel do gestor · Ops Ahead' }];
}

export async function loader({ params }: Route.LoaderArgs) {
  return withTenant(params.tenant, () => loadDashboard());
}

/** The band is stored as the severities themselves; this is the only place
 * that turns [1,2] into "P1 + P2". */
function bandLabel(severities: number[]): string {
  return severities.map(s => `P${s}`).join(' + ');
}

const bandKey = (severities: number[]) => severities.join(',');

function buildKpis(kpiAchievement: KpiAchievementRow[], kpiProjection: KpiProjectionRow[]): Kpi[] {
  // Whichever bands the tenant configured, in the order the mart returns them
  // — never a fixed p1_p2/p3 pair.
  const groups = [
    ...new Set([...kpiAchievement, ...kpiProjection].map(r => bandKey(r.severities))),
  ];
  const kpis: Kpi[] = [];

  for (const group of groups) {
    const achievementRows = kpiAchievement
      .filter(row => bandKey(row.severities) === group)
      .sort((a, b) => a.year - b.year || a.month.localeCompare(b.month));
    const latest = achievementRows.at(-1);
    if (latest) {
      kpis.push({
        label: `Meta anual — ${bandLabel(latest.severities)}`,
        value: `${latest.achievement_pct}%`,
        delta: `${latest.breached_ytd} violações acumuladas no ano`,
        tone:
          latest.achievement_pct >= 100 ? 'green' : latest.achievement_pct >= 75 ? 'amber' : 'red',
        icon: 'alert-circle',
        sparkline:
          achievementRows.length > 1 ? achievementRows.map(r => r.achievement_pct) : undefined,
      });
    }

    const projection = kpiProjection.find(r => bandKey(r.severities) === group);
    if (projection) {
      kpis.push({
        label: `Projeção — ${bandLabel(projection.severities)}`,
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
  return (
    <Panel title="Previsão de volume" className="mt-6">
      <p className="mb-4 text-sm text-text-muted">
        Ocorrências previstas por grupo de prioridade em D+1 e D+7. O trecho translúcido no topo vai
        até o limite superior da faixa de 80% publicada pelo modelo.
      </p>
      <ForecastChart rows={rows} />
    </Panel>
  );
}

/** Mean daily volume per product over the window categoryTrends covers — the
 * baseline the forecast is read against. */
function recentDailyMean(trends: CategoryTrendRow[]): Map<string, number> {
  const totals = new Map<string, { sum: number; days: number }>();
  for (const row of trends) {
    const key = `${row.category}|${row.product}`;
    const acc = totals.get(key) ?? { sum: 0, days: 0 };
    totals.set(key, { sum: acc.sum + row.total_incidents, days: acc.days + 1 });
  }
  return new Map([...totals].map(([key, { sum, days }]) => [key, days > 0 ? sum / days : 0]));
}

function EntityForecastTable({
  rows,
  trends,
}: {
  rows: EntityForecastRow[];
  trends: CategoryTrendRow[];
}) {
  const baseline = recentDailyMean(trends);

  return (
    <Panel title="Produtos que exigem atenção" className="mt-6">
      <p className="mb-4 text-sm text-text-muted">
        Volume previsto por produto, ordenado pela previsão. A variação compara a previsão com a
        média diária realizada no período recente.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border-base">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-bg-elevated text-text-muted text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Horizonte</th>
              <th className="px-4 py-3">Previsto</th>
              <th className="px-4 py-3">Faixa 80%</th>
              <th className="px-4 py-3">vs. recente</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map(row => {
              const mean = baseline.get(`${row.category}|${row.product}`);
              const growth = mean && mean > 0 ? (row.yhat - mean) / mean : null;
              return (
                <tr
                  key={`${row.category}-${row.product}-${row.horizon}`}
                  className="border-border-base border-t"
                >
                  <td className="px-4 py-3 text-text-light">{row.category || '—'}</td>
                  <td className="px-4 py-3 text-text-muted">{row.product || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-muted">D+{row.horizon}</td>
                  <td className="px-4 py-3 font-mono text-text-light">{Math.round(row.yhat)}</td>
                  <td className="px-4 py-3 font-mono text-text-dim">
                    {Math.round(row.yhat_lower)}–{Math.round(row.yhat_upper)}
                  </td>
                  <td className="px-4 py-3">
                    {growth === null ? (
                      <span className="text-text-dim">—</span>
                    ) : (
                      <Badge tone={growth > 0.2 ? 'amber' : 'neutral'}>
                        {growth >= 0 ? '+' : ''}
                        {Math.round(growth * 100)}%
                      </Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// Below this the grouping did not separate the entities, and the honest
// reading is "no pattern", not a set of groups drawn anyway.
const MIN_SILHOUETTE = 0.25;

function RecurringCausesSection({ rows }: { rows: RecurringCauseGroupRow[] }) {
  const silhouette = rows[0]?.silhouette ?? 0;

  return (
    <Panel title="Comportamentos recorrentes" className="mt-6">
      {silhouette < MIN_SILHOUETTE ? (
        <p className="text-sm text-text-muted">
          O agrupamento não encontrou estrutura nas entidades desta janela (qualidade{' '}
          {silhouette.toFixed(2)}). Nada aqui sustenta uma leitura por comportamento — a lista por
          volume continua sendo a referência.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-text-muted">
            {rows.length} grupos de entidades que falham de forma parecida, independentemente de
            categoria e produto. Qualidade do agrupamento: {silhouette.toFixed(2)}.
          </p>
          <ul className="divide-y divide-border-base rounded-lg border border-border-base">
            {rows.map(group => (
              <li key={group.group_id} className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-text-light">Grupo {group.group_id}</span>
                  <Badge tone="neutral">{group.entity_count} entidades</Badge>
                </div>
                <p className="mt-2 font-mono text-xs text-text-muted">
                  {group.distinguishing_features || 'sem desvio relevante da mediana'}
                </p>
                <p className="mt-1 text-xs text-text-dim">{group.top_products}</p>
              </li>
            ))}
          </ul>
        </>
      )}
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
    entityForecast,
    recurringCauseGroups,
  } = loaderData;
  const tenant = useTenantSlug();

  const kpis = buildKpis(kpiAchievement, kpiProjection);

  return (
    <main className="px-8 py-6">
      <PageHeader
        title="Painel do gestor"
        subtitle="Fechamento do mês contra a meta anual, e o que vem pela frente."
        action={
          <Link to={queuePath(tenant)} className="text-sm text-text-muted hover:text-text-light">
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
      {entityForecast.length > 0 && (
        <EntityForecastTable rows={entityForecast} trends={categoryTrends} />
      )}
      {recurringCauseGroups.length > 0 && <RecurringCausesSection rows={recurringCauseGroups} />}
      {categoryTrends.length > 0 && <CategoryTrendsTable rows={categoryTrends} />}
      {groupLoad.length > 0 && <GroupLoadSection rows={groupLoad} />}

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

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Painel do gestor" service="O painel" />;
}
