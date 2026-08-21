import {
  type CategoryTrendRow,
  fetchCategoryTrends,
  fetchGroupLoad,
  fetchKpiAchievement,
  fetchKpiProjection,
  fetchNoisyEntities,
  fetchVolumeForecast,
  type GroupLoadRow,
  type KpiAchievementRow,
  type KpiProjectionRow,
  type NoisyEntityRow,
  type VolumeForecastRow,
} from './clickhouse.server.ts';

export interface DashboardData {
  kpiAchievement: KpiAchievementRow[];
  kpiProjection: KpiProjectionRow[];
  volumeForecast: VolumeForecastRow[];
  categoryTrends: CategoryTrendRow[];
  groupLoad: GroupLoadRow[];
  noisyEntities: NoisyEntityRow[];
}

export interface BuildDashboardOptions {
  fetchKpiAchievement: () => Promise<KpiAchievementRow[]>;
  fetchKpiProjection: () => Promise<KpiProjectionRow[]>;
  fetchVolumeForecast: () => Promise<VolumeForecastRow[]>;
  fetchCategoryTrends: () => Promise<CategoryTrendRow[]>;
  fetchGroupLoad: () => Promise<GroupLoadRow[]>;
  fetchNoisyEntities: () => Promise<NoisyEntityRow[]>;
}

/**
 * Every panel is read independently — one gold table per concern, no join
 * that would force a panel empty because another one's table lagged.
 */
export async function buildDashboard(options: BuildDashboardOptions): Promise<DashboardData> {
  const [kpiAchievement, kpiProjection, volumeForecast, categoryTrends, groupLoad, noisyEntities] =
    await Promise.all([
      options.fetchKpiAchievement(),
      options.fetchKpiProjection(),
      options.fetchVolumeForecast(),
      options.fetchCategoryTrends(),
      options.fetchGroupLoad(),
      options.fetchNoisyEntities(),
    ]);

  return {
    kpiAchievement,
    kpiProjection,
    volumeForecast,
    categoryTrends,
    groupLoad,
    noisyEntities: [...noisyEntities].sort((a, b) => b.signal_count - a.signal_count),
  };
}

/** The dashboard as the route loader builds it, against the real dependencies. */
export async function loadDashboard(): Promise<DashboardData> {
  return await buildDashboard({
    fetchKpiAchievement: () => fetchKpiAchievement(),
    fetchKpiProjection: () => fetchKpiProjection(),
    fetchVolumeForecast: () => fetchVolumeForecast(),
    fetchCategoryTrends: () => fetchCategoryTrends(),
    fetchGroupLoad: () => fetchGroupLoad(),
    fetchNoisyEntities: () => fetchNoisyEntities(),
  });
}
