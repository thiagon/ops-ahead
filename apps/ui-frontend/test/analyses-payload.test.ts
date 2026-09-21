import { describe, expect, it } from 'vitest';
import { buildAnalysisRequest } from '../app/features/analyses/payload.ts';
import { ANALYSES, isTenantScoped } from '../app/features/analyses/types.ts';

describe('buildAnalysisRequest', () => {
  it('requires split dates for supervised trainings', () => {
    expect(buildAnalysisRequest('locaweb', { analysis: 'volume_forecast' })).toBe(
      'Fim do treino é obrigatório.',
    );
  });

  it('builds a volume_forecast body when dates advance', () => {
    expect(
      buildAnalysisRequest('locaweb', {
        analysis: 'volume_forecast',
        train_end: '2025-05-31',
        validation_end: '2025-09-30',
        holdout_end: '2025-12-31',
      }),
    ).toEqual({
      analysis: 'volume_forecast',
      tenant_id: 'locaweb',
      train_end: '2025-05-31',
      validation_end: '2025-09-30',
      holdout_end: '2025-12-31',
    });
  });

  it('rejects a split that does not advance', () => {
    expect(
      buildAnalysisRequest('locaweb', {
        analysis: 'breach_risk',
        train_end: '2025-09-30',
        validation_end: '2025-05-31',
        holdout_end: '2025-12-31',
      }),
    ).toBe('As datas precisam avançar: treino < validação < holdout.');
  });

  it('omits optional fields for kpi_projection', () => {
    expect(buildAnalysisRequest('locaweb', { analysis: 'kpi_projection' })).toEqual({
      analysis: 'kpi_projection',
      tenant_id: 'locaweb',
    });
  });

  it('parses optional contamination for external_event_detection', () => {
    expect(
      buildAnalysisRequest('locaweb', {
        analysis: 'external_event_detection',
        contamination: '0.1',
      }),
    ).toEqual({
      analysis: 'external_event_detection',
      tenant_id: 'locaweb',
      contamination: 0.1,
    });
  });

  it.each(['full_pipeline', 'data_refresh', 'data_quality_check'])(
    'omits tenant_id for %s, whose schema is strict about it',
    analysis => {
      expect(buildAnalysisRequest('locaweb', { analysis })).toEqual({ analysis });
    },
  );

  it('builds a body for every analysis the screen offers', () => {
    const splits = {
      train_end: '2025-05-31',
      validation_end: '2025-09-30',
      holdout_end: '2025-12-31',
    };

    for (const analysis of ANALYSES) {
      const body = buildAnalysisRequest('locaweb', { analysis, ...splits });

      expect(typeof body, `${analysis} did not build`).not.toBe('string');
      expect(body).toMatchObject({ analysis });
      if (typeof body !== 'string') {
        expect(body.tenant_id, analysis).toBe(isTenantScoped(analysis) ? 'locaweb' : undefined);
      }
    }
  });
});
