import { describe, expect, it } from 'vitest';
import { triggerRequestSchema } from '../../../../src/modules/trigger/schema.ts';

describe('triggerRequestSchema', () => {
  it.each(['volume_forecast', 'breach_risk'] as const)(
    'requires the split dates for %s',
    analysis => {
      const result = triggerRequestSchema.safeParse({ analysis });

      expect(result.success).toBe(false);
    },
  );

  it.each(['volume_forecast', 'breach_risk'] as const)(
    'accepts %s with all split dates',
    analysis => {
      const result = triggerRequestSchema.safeParse({
        analysis,
        train_end: '2025-09-30',
        validation_end: '2025-10-31',
        holdout_end: '2026-01-31',
      });

      expect(result.success).toBe(true);
    },
  );

  it.each(['data_refresh', 'data_quality_check'] as const)('accepts bare %s', analysis => {
    const result = triggerRequestSchema.safeParse({ analysis });

    expect(result.success).toBe(true);
  });

  it.each(['kpi_projection', 'external_event_detection'] as const)(
    'accepts bare %s — no split dates required',
    analysis => {
      const result = triggerRequestSchema.safeParse({ analysis });

      expect(result.success).toBe(true);
    },
  );

  it('accepts kpi_projection with all its optional fields', () => {
    const result = triggerRequestSchema.safeParse({
      analysis: 'kpi_projection',
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
    const result = triggerRequestSchema.safeParse({ analysis: 'kpi_projection', n_simulations: 5000.5 });

    expect(result.success).toBe(false);
  });

  it('accepts external_event_detection with contamination in range', () => {
    const result = triggerRequestSchema.safeParse({ analysis: 'external_event_detection', contamination: 0.05 });

    expect(result.success).toBe(true);
  });

  it('rejects external_event_detection with contamination out of range', () => {
    const result = triggerRequestSchema.safeParse({ analysis: 'external_event_detection', contamination: 0.9 });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown analysis', () => {
    const result = triggerRequestSchema.safeParse({ analysis: 'full_pipeline' });

    expect(result.success).toBe(false);
  });

  it('rejects a data_source override — removed for SSRF/credential-leak risk', () => {
    const result = triggerRequestSchema.safeParse({
      analysis: 'data_refresh',
      data_source: 'clickhouse://attacker.example/x',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a malformed split date', () => {
    const result = triggerRequestSchema.safeParse({
      analysis: 'volume_forecast',
      train_end: '30-09-2025',
      validation_end: '2025-10-31',
      holdout_end: '2026-01-31',
    });

    expect(result.success).toBe(false);
  });
});
