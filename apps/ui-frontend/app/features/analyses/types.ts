/**
 * Every analysis the gateway accepts, mirroring the discriminated union in
 * apps/ui-gateway/src/services/analyses/schema.ts whole. The screen never
 * carries a subset of its own: an analysis the gateway accepts and this list
 * omits is one nobody can start without a shell, which is what this screen
 * exists to remove. `analysis` is the domain's own word
 * (domain/ubiquitous-language.md#analysis) — never a job, topic or image name.
 */
export const ANALYSES = [
  'full_pipeline',
  'data_refresh',
  'data_quality_check',
  'volume_forecast',
  'entity_forecast',
  'breach_risk',
  'kpi_projection',
  'external_event_detection',
  'recurring_causes',
  'drift_monitoring',
] as const;

export type Analysis = (typeof ANALYSES)[number];

export const ANALYSIS_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;

export type AnalysisStatusValue = (typeof ANALYSIS_STATUSES)[number];

export type AnalysisTrigger = 'manual' | 'scheduled' | 'chained';

export type AnalysisRun = {
  id: string;
  analysis?: string;
  tenant_id?: string;
  trigger?: AnalysisTrigger;
  status: AnalysisStatusValue;
  started_at?: string;
  finished_at?: string;
  detail?: Record<string, unknown>;
};

export const ANALYSIS_LABEL: Record<Analysis, string> = {
  full_pipeline: 'Pipeline completa',
  data_refresh: 'Rematerializar os marts',
  data_quality_check: 'Verificar qualidade',
  volume_forecast: 'Previsão de volume',
  entity_forecast: 'Previsão por produto',
  breach_risk: 'Risco de violação',
  kpi_projection: 'Projeção de KPI',
  external_event_detection: 'Detecção de evento externo',
  recurring_causes: 'Causas recorrentes',
  drift_monitoring: 'Monitoramento de drift',
};

export const ANALYSIS_HINT: Record<Analysis, string> = {
  full_pipeline:
    'Transforma, valida e encadeia os treinos — a mesma cadeia que o CronJob diário dispara.',
  data_refresh: 'Só o dbt: reconstrói os marts a partir do dado recebido, sem validar nem treinar.',
  data_quality_check: 'Só a suite do Great Expectations sobre os marts já materializados.',
  volume_forecast: 'Prophet + LightGBM por faixa de prioridade (D+1 e D+7).',
  entity_forecast: 'Volume previsto por categoria e produto.',
  breach_risk: 'Probabilidade de violação de OLA em ocorrências abertas.',
  kpi_projection: 'Simulação do fechamento da meta anual — sem recorte temporal.',
  external_event_detection:
    'Isolation Forest sobre o dia de ocorrências, somado aos sinais de monitor quando houver.',
  recurring_causes: 'Agrupa entidades com comportamento repetido no histórico.',
  drift_monitoring:
    'PSI/KS entre a janela de treino do modelo em produção e a janela atual — não treina nada.',
};

export const STATUS_LABEL: Record<AnalysisStatusValue, string> = {
  pending: 'Na fila',
  running: 'Em execução',
  succeeded: 'Concluído',
  failed: 'Falhou',
};

export const TRIGGER_LABEL: Record<AnalysisTrigger, string> = {
  manual: 'Manual',
  scheduled: 'Agendada',
  chained: 'Encadeada',
};

/**
 * The data analyses rebuild every mart at once, so they carry no tenant_id —
 * sending one is rejected, the gateway's schemas being strict.
 */
const DATA_ANALYSES = new Set<Analysis>(['full_pipeline', 'data_refresh', 'data_quality_check']);

export function isTenantScoped(analysis: Analysis): boolean {
  return !DATA_ANALYSES.has(analysis);
}

export function needsSplitDates(analysis: Analysis): boolean {
  return (
    analysis === 'volume_forecast' || analysis === 'entity_forecast' || analysis === 'breach_risk'
  );
}

export function isAnalysis(value: string): value is Analysis {
  return (ANALYSES as readonly string[]).includes(value);
}
