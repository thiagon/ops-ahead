import { describe, expect, it, vi } from 'vitest';
import type {
  CategoryTrendRow,
  GroupLoadRow,
  KpiAchievementRow,
  KpiProjectionRow,
  NoisyEntityRow,
  VolumeForecastRow,
} from '../app/clickhouse.server.ts';
import { buildDashboard } from '../app/dashboard.server.ts';

function kpiAchievementRow(overrides: Partial<KpiAchievementRow> = {}): KpiAchievementRow {
  return {
    year: 2026,
    month: '2026-08-01',
    kpi_group: 'p1_p2',
    breached_ytd: 20,
    achievement_pct: 100,
    ...overrides,
  };
}

function kpiProjectionRow(overrides: Partial<KpiProjectionRow> = {}): KpiProjectionRow {
  return {
    tenant_id: 'locaweb',
    as_of_date: '2026-08-21',
    kpi_group: 'p1_p2',
    median_breaches_ytd: 32,
    ci80_lower: 28,
    ci80_upper: 38,
    p_within_target: 0.7,
    ...overrides,
  };
}

function volumeForecastRow(overrides: Partial<VolumeForecastRow> = {}): VolumeForecastRow {
  return {
    target_date: '2026-08-22',
    priority_group: 'p1_p2',
    horizon: 1,
    yhat: 12,
    yhat_lower: 9,
    yhat_upper: 15,
    ...overrides,
  };
}

function categoryTrendRow(overrides: Partial<CategoryTrendRow> = {}): CategoryTrendRow {
  return {
    date: '2026-08-21',
    category: 'rede',
    product: 'vps',
    total_incidents: 5,
    p1_count: 0,
    p2_count: 1,
    p3_count: 2,
    p4_count: 1,
    p5_count: 1,
    avg_duration_seconds: 3600,
    ...overrides,
  };
}

function groupLoadRow(overrides: Partial<GroupLoadRow> = {}): GroupLoadRow {
  return {
    owner: 'infra',
    snapshot_at: '2026-08-21 12:00:00',
    incidents_open: 4,
    ...overrides,
  };
}

function noisyEntityRow(overrides: Partial<NoisyEntityRow> = {}): NoisyEntityRow {
  return {
    entity_id: 'srv-01',
    window_minutes: 60,
    signal_count: 40,
    ...overrides,
  };
}

describe('KPI achievement panel', () => {
  it('reads gold_alert_kpi_achievement grouped by kpi_group', async () => {
    const fetchKpiAchievement = vi.fn(async () => [
      kpiAchievementRow({ kpi_group: 'p1_p2' }),
      kpiAchievementRow({ kpi_group: 'p3' }),
    ]);

    const dashboard = await buildDashboard({
      fetchKpiAchievement,
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
    });

    expect(fetchKpiAchievement).toHaveBeenCalled();
    expect(dashboard.kpiAchievement.map(row => row.kpi_group)).toEqual(['p1_p2', 'p3']);
  });

  it('never collapses p1_p2 and p3 into one severity bucket', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [
        kpiAchievementRow({ kpi_group: 'p1_p2', breached_ytd: 20 }),
        kpiAchievementRow({ kpi_group: 'p3', breached_ytd: 150 }),
      ],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
    });

    const p1p2 = dashboard.kpiAchievement.find(row => row.kpi_group === 'p1_p2');
    const p3 = dashboard.kpiAchievement.find(row => row.kpi_group === 'p3');
    expect(p1p2?.breached_ytd).toBe(20);
    expect(p3?.breached_ytd).toBe(150);
  });
});

describe('closing projection panel', () => {
  it('carries the interval and probability from gold_kpi_projection', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [kpiProjectionRow()],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
    });

    expect(dashboard.kpiProjection[0]).toMatchObject({
      kpi_group: 'p1_p2',
      ci80_lower: 28,
      ci80_upper: 38,
      p_within_target: 0.7,
    });
  });
});

describe('volume forecast panel', () => {
  it('carries D+1 and D+7 by priority group', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [
        volumeForecastRow({ horizon: 1 }),
        volumeForecastRow({ horizon: 7, yhat: 20 }),
      ],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
    });

    expect(dashboard.volumeForecast.map(row => row.horizon)).toEqual([1, 7]);
  });
});

describe('category trends panel', () => {
  it('keeps p2 and p3 as separate counts, never collapsed', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [categoryTrendRow({ p2_count: 3, p3_count: 9 })],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
    });

    expect(dashboard.categoryTrends[0]).toMatchObject({ p2_count: 3, p3_count: 9 });
  });
});

describe('group load and noisy resources panel', () => {
  it('carries current load per owner group', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [groupLoadRow({ owner: 'infra', incidents_open: 4 })],
      fetchNoisyEntities: async () => [],
    });

    expect(dashboard.groupLoad[0]).toMatchObject({ owner: 'infra', incidents_open: 4 });
  });

  it('ranks noisy entities by signal_count over the last hour', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [
        noisyEntityRow({ entity_id: 'srv-quiet', signal_count: 5 }),
        noisyEntityRow({ entity_id: 'srv-noisy', signal_count: 90 }),
      ],
    });

    expect(dashboard.noisyEntities.map(row => row.entity_id)).toEqual(['srv-noisy', 'srv-quiet']);
  });
});
