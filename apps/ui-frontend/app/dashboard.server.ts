import {
  type CategoryTrendRow,
  type EntityForecastRow,
  fetchCategoryTrends,
  fetchEntityForecast,
  fetchGroupLoad,
  fetchKpiAchievement,
  fetchKpiProjection,
  fetchNoisyEntities,
  fetchRecurringCauseGroups,
  fetchVolumeForecast,
  type GroupLoadRow,
  type KpiAchievementRow,
  type KpiProjectionRow,
  type NoisyEntityRow,
  type RecurringCauseGroupRow,
  type VolumeForecastRow,
} from './clickhouse.server.ts';

export interface DashboardData {
  kpiAchievement: KpiAchievementRow[];
  kpiProjection: KpiProjectionRow[];
  volumeForecast: VolumeForecastRow[];
  categoryTrends: CategoryTrendRow[];
  groupLoad: GroupLoadRow[];
  noisyEntities: NoisyEntityRow[];
  entityForecast: EntityForecastRow[];
  recurringCauseGroups: RecurringCauseGroupRow[];
}

export interface BuildDashboardOptions {
  fetchKpiAchievement: () => Promise<KpiAchievementRow[]>;
  fetchKpiProjection: () => Promise<KpiProjectionRow[]>;
  fetchVolumeForecast: () => Promise<VolumeForecastRow[]>;
  fetchCategoryTrends: () => Promise<CategoryTrendRow[]>;
  fetchGroupLoad: () => Promise<GroupLoadRow[]>;
  fetchNoisyEntities: () => Promise<NoisyEntityRow[]>;
  fetchEntityForecast: () => Promise<EntityForecastRow[]>;
  fetchRecurringCauseGroups: () => Promise<RecurringCauseGroupRow[]>;
}

/**
 * Every panel is read independently — one gold table per concern, no join
 * that would force a panel empty because another one's table lagged.
 */
export async function buildDashboard(options: BuildDashboardOptions): Promise<DashboardData> {
  const [
    kpiAchievement,
    kpiProjection,
    volumeForecast,
    categoryTrends,
    groupLoad,
    noisyEntities,
    entityForecast,
    recurringCauseGroups,
  ] = await Promise.all([
    options.fetchKpiAchievement(),
    options.fetchKpiProjection(),
    options.fetchVolumeForecast(),
    options.fetchCategoryTrends(),
    options.fetchGroupLoad(),
    options.fetchNoisyEntities(),
    options.fetchEntityForecast(),
    options.fetchRecurringCauseGroups(),
  ]);

  return {
    kpiAchievement,
    kpiProjection,
    volumeForecast,
    categoryTrends,
    groupLoad,
    noisyEntities: [...noisyEntities].sort((a, b) => b.signal_count - a.signal_count),
    // Ordered by forecast volume: the panel answers "which products need
    // attention", so the answer has to be the first row.
    entityForecast: [...entityForecast].sort((a, b) => b.yhat - a.yhat),
    recurringCauseGroups,
  };
}

/** The dashboard as the route loader builds it, against the real dependencies. */
export async function loadDashboard(): Promise<DashboardData> {
  return await buildDashboard({
    fetchKpiAchievement: () => fetchKpiAchievement().catch(() => []),
    fetchKpiProjection: () => fetchKpiProjection().catch(() => []),
    fetchVolumeForecast: () => fetchVolumeForecast().catch(() => []),
    fetchCategoryTrends: () => fetchCategoryTrends().catch(() => []),
    fetchGroupLoad: () => fetchGroupLoad().catch(() => []),
    fetchNoisyEntities: () => fetchNoisyEntities().catch(() => []),
    fetchEntityForecast: () => fetchEntityForecast().catch(() => []),
    fetchRecurringCauseGroups: () => fetchRecurringCauseGroups().catch(() => []),
  });
}
