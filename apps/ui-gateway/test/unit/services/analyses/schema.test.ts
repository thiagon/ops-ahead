import { describe, expect, it } from 'vitest';
import {
  analysisRequestSchema,
  analysisStatusUpdateSchema,
} from '../../../../src/services/analyses/index.ts';

describe('analysisRequestSchema', () => {
  it.each(['volume_forecast', 'breach_risk'] as const)(
    'requires the split dates for %s',
    analysis => {
      const result = analysisRequestSchema.safeParse({ analysis });

      expect(result.success).toBe(false);
    },
  );

  it.each(['volume_forecast', 'breach_risk'] as const)(
    'accepts %s with all split dates',
    analysis => {
      const result = analysisRequestSchema.safeParse({
        analysis,
        tenant_id: 'locaweb',
        train_end: '2025-09-30',
        validation_end: '2025-10-31',
        holdout_end: '2026-01-31',
      });

      expect(result.success).toBe(true);
    },
  );

  it.each(['data_refresh', 'data_quality_check'] as const)('accepts bare %s', analysis => {
    const result = analysisRequestSchema.safeParse({ analysis });

    expect(result.success).toBe(true);
  });

  it.each(['kpi_projection', 'external_event_detection'] as const)(
    'accepts %s without split dates, but never without a tenant',
    analysis => {
      expect(analysisRequestSchema.safeParse({ analysis }).success).toBe(false);
      expect(
        analysisRequestSchema.safeParse({ analysis, tenant_id: 'locaweb' }).success,
      ).toBe(true);
    },
  );

  it('accepts kpi_projection with all its optional fields', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'kpi_projection',
      tenant_id: 'locaweb',
      n_simulations: 5000,
      seed: 7,
      kpi_target_volume_p2: 500,
      kpi_target_volume_p3: 1200,
      kpi_target_breaches_p2: 10,
      kpi_target_breaches_p3: 15,
    });

    expect(result.success).toBe(true);
  });

  it('rejects kpi_projection with a non-integer n_simulations', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'kpi_projection',
      tenant_id: 'locaweb',
      n_simulations: 5000.5,
    });

    expect(result.success).toBe(false);
  });

  it('accepts external_event_detection with contamination in range', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'external_event_detection',
      tenant_id: 'locaweb',
      contamination: 0.05,
    });

    expect(result.success).toBe(true);
  });

  it('rejects external_event_detection with contamination out of range', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'external_event_detection',
      tenant_id: 'locaweb',
      contamination: 0.9,
    });

    expect(result.success).toBe(false);
  });

  it.each(['data_refresh', 'data_quality_check', 'full_pipeline'] as const)(
    'takes no tenant for %s, which rebuilds every mart at once',
    analysis => {
      expect(analysisRequestSchema.safeParse({ analysis }).success).toBe(true);
    },
  );

  it('rejects a training without a tenant — there is one model per tenant', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'volume_forecast',
      train_end: '2025-09-30',
      validation_end: '2025-10-31',
      holdout_end: '2026-01-31',
    });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown analysis', () => {
    const result = analysisRequestSchema.safeParse({ analysis: 'retrain_everything' });

    expect(result.success).toBe(false);
  });

  it('accepts full_pipeline — the CronJob reaches the route like any caller', () => {
    const result = analysisRequestSchema.safeParse({ analysis: 'full_pipeline' });

    expect(result.success).toBe(true);
  });

  it('accepts entity_forecast with the same splits volume_forecast takes', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'entity_forecast',
      tenant_id: 'locaweb',
      train_end: '2026-01-01',
      validation_end: '2026-02-01',
      holdout_end: '2026-03-01',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a data_source override — removed for SSRF/credential-leak risk', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'data_refresh',
      data_source: 'clickhouse://attacker.example/x',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed split date', () => {
    const result = analysisRequestSchema.safeParse({
      analysis: 'volume_forecast',
      tenant_id: 'locaweb',
      train_end: '30-09-2025',
      validation_end: '2025-10-31',
      holdout_end: '2026-01-31',
    });

    expect(result.success).toBe(false);
  });
});

describe('analysisStatusUpdateSchema', () => {
  it('accepts a running update without an id — the path carries that', () => {
    const result = analysisStatusUpdateSchema.safeParse({
      status: 'running',
      started_at: '2026-08-15T12:30:00Z',
    });

    expect(result.success).toBe(true);
  });

  it('rejects the old PascalCase status values', () => {
    const result = analysisStatusUpdateSchema.safeParse({ status: 'Running' });

    expect(result.success).toBe(false);
  });

  it('rejects a body without status', () => {
    const result = analysisStatusUpdateSchema.safeParse({ started_at: '2026-08-15T12:30:00Z' });

    expect(result.success).toBe(false);
  });
});
