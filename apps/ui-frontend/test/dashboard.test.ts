import { describe, expect, it, vi } from 'vitest';
import type {
  CategoryTrendRow,
  EntityForecastRow,
  GroupLoadRow,
  KpiAchievementRow,
  KpiProjectionRow,
  NoisyEntityRow,
  RecurringCauseGroupRow,
  VolumeForecastRow,
} from '../app/clickhouse.server.ts';
import { buildDashboard } from '../app/dashboard.server.ts';

function kpiAchievementRow(overrides: Partial<KpiAchievementRow> = {}): KpiAchievementRow {
  return {
    year: 2026,
    month: '2026-08-01',
    severities: [1, 2],
    breached_ytd: 20,
    achievement_pct: 100,
    ...overrides,
  };
}

function kpiProjectionRow(overrides: Partial<KpiProjectionRow> = {}): KpiProjectionRow {
  return {
    tenant_id: 'locaweb',
    as_of_date: '2026-08-21',
    severities: [1, 2],
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

function entityForecastRow(overrides: Partial<EntityForecastRow> = {}): EntityForecastRow {
  return {
    target_date: '2026-08-22',
    category: 'rede',
    product: 'vps',
    horizon: 1,
    yhat: 12,
    yhat_lower: 9,
    yhat_upper: 15,
    ...overrides,
  };
}

function recurringCauseGroupRow(
  overrides: Partial<RecurringCauseGroupRow> = {},
): RecurringCauseGroupRow {
  return {
    group_id: 0,
    entity_count: 12,
    silhouette: 0.62,
    distinguishing_features: 'breach_rate +140%; duration_mean +80%',
    top_products: 'vps (7), cloud (5)',
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
  it('reads gold_alert_kpi_achievement grouped by the configured band', async () => {
    const fetchKpiAchievement = vi.fn(async () => [
      kpiAchievementRow({ severities: [1, 2] }),
      kpiAchievementRow({ severities: [3] }),
    ]);

    const dashboard = await buildDashboard({
      fetchKpiAchievement,
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(fetchKpiAchievement).toHaveBeenCalled();
    expect(dashboard.kpiAchievement.map(row => row.severities)).toEqual([[1, 2], [3]]);
  });

  it('keeps the rest of the dashboard when one panel has nothing to show', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [kpiAchievementRow()],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [categoryTrendRow()],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.kpiAchievement).toHaveLength(1);
    expect(dashboard.kpiProjection).toEqual([]);
    expect(dashboard.categoryTrends).toHaveLength(1);
  });

  it('never collapses two bands into one severity bucket', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [
        kpiAchievementRow({ severities: [1, 2], breached_ytd: 20 }),
        kpiAchievementRow({ severities: [3], breached_ytd: 150 }),
      ],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    const p1p2 = dashboard.kpiAchievement.find(row => row.severities.join() === '1,2');
    const p3 = dashboard.kpiAchievement.find(row => row.severities.join() === '3');
    expect(p1p2?.breached_ytd).toBe(20);
    expect(p3?.breached_ytd).toBe(150);
  });

  it('carries a band the Locaweb dataset never had', async () => {
    // Nothing in the read path knows which severities form a band, so a
    // tenant measuring [1,2,4] reaches the panel like any other.
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [kpiAchievementRow({ severities: [1, 2, 4] })],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.kpiAchievement[0]?.severities).toEqual([1, 2, 4]);
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
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.kpiProjection[0]).toMatchObject({
      severities: [1, 2],
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
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
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
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
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
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
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
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.noisyEntities.map(row => row.entity_id)).toEqual(['srv-noisy', 'srv-quiet']);
  });
});

describe('entity forecast panel', () => {
  it('names the products with the most incidents forecast', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [
        entityForecastRow({ product: 'vps', yhat: 4 }),
        entityForecastRow({ product: 'cloud', yhat: 21 }),
      ],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.entityForecast.map(row => row.product)).toEqual(['cloud', 'vps']);
  });

  it('keeps each horizon as its own series', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [
        entityForecastRow({ product: 'vps', horizon: 1, yhat: 12 }),
        entityForecastRow({ product: 'vps', horizon: 7, yhat: 30 }),
      ],
      fetchRecurringCauseGroups: async () => [],
    });

    expect(dashboard.entityForecast).toHaveLength(2);
    expect(dashboard.entityForecast.map(row => row.horizon).sort()).toEqual([1, 7]);
  });
});

describe('recurring causes panel', () => {
  it('carries the groups and what distinguishes each one', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [
        recurringCauseGroupRow({ group_id: 0 }),
        recurringCauseGroupRow({ group_id: 1, entity_count: 4 }),
      ],
    });

    expect(dashboard.recurringCauseGroups).toHaveLength(2);
    expect(dashboard.recurringCauseGroups[0]?.distinguishing_features).toContain('breach_rate');
  });

  it('carries the silhouette so the screen can say no pattern was found', async () => {
    const dashboard = await buildDashboard({
      fetchKpiAchievement: async () => [],
      fetchKpiProjection: async () => [],
      fetchVolumeForecast: async () => [],
      fetchCategoryTrends: async () => [],
      fetchGroupLoad: async () => [],
      fetchNoisyEntities: async () => [],
      fetchEntityForecast: async () => [],
      fetchRecurringCauseGroups: async () => [recurringCauseGroupRow({ silhouette: 0.08 })],
    });

    expect(dashboard.recurringCauseGroups[0]?.silhouette).toBeLessThan(0.2);
  });
});
