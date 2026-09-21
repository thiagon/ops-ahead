import { type Analysis, isAnalysis, isTenantScoped, needsSplitDates } from './types.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AnalysisFormInput = {
  analysis: string;
  train_end?: string;
  validation_end?: string;
  holdout_end?: string;
  n_simulations?: string;
  seed?: string;
  contamination?: string;
  window_days?: string;
};

/** Body for POST /:tenant/analyses — tenant_id only when the contract requires it. */
export type AnalysisRequest = {
  analysis: Analysis;
  tenant_id?: string;
  train_end?: string;
  validation_end?: string;
  holdout_end?: string;
  n_simulations?: number;
  seed?: number;
  contamination?: number;
  window_days?: number;
};

function optionalInt(raw: string | undefined, label: string): number | string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) return `${label} precisa ser um inteiro.`;
  return n;
}

function optionalFloat(raw: string | undefined, label: string): number | string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} precisa ser um número.`;
  return n;
}

/**
 * Turns the form fields into the gateway body, or a Portuguese error string.
 * Split dates are required only for the supervised trainings.
 */
export function buildAnalysisRequest(
  tenant: string,
  input: AnalysisFormInput,
): AnalysisRequest | string {
  if (!isAnalysis(input.analysis)) {
    return 'Escolha uma análise.';
  }

  const body: AnalysisRequest = { analysis: input.analysis };
  if (isTenantScoped(input.analysis)) {
    body.tenant_id = tenant;
  }

  if (needsSplitDates(input.analysis)) {
    const train_end = (input.train_end ?? '').trim();
    const validation_end = (input.validation_end ?? '').trim();
    const holdout_end = (input.holdout_end ?? '').trim();

    for (const [label, value] of [
      ['Fim do treino', train_end],
      ['Fim da validação', validation_end],
      ['Fim do holdout', holdout_end],
    ] as const) {
      if (!value) {
        return `${label} é obrigatório.`;
      }
      if (!DATE_RE.test(value)) {
        return `${label} precisa ser uma data YYYY-MM-DD.`;
      }
    }
    if (train_end >= validation_end || validation_end >= holdout_end) {
      return 'As datas precisam avançar: treino < validação < holdout.';
    }
    body.train_end = train_end;
    body.validation_end = validation_end;
    body.holdout_end = holdout_end;
  }

  if (input.analysis === 'kpi_projection') {
    const n = optionalInt(input.n_simulations, 'Número de simulações');
    if (typeof n === 'string') return n;
    if (n !== undefined) {
      if (n <= 0) return 'Número de simulações precisa ser positivo.';
      body.n_simulations = n;
    }
    const seed = optionalInt(input.seed, 'Semente');
    if (typeof seed === 'string') return seed;
    if (seed !== undefined) body.seed = seed;
  }

  if (input.analysis === 'external_event_detection') {
    const contamination = optionalFloat(input.contamination, 'Contaminação');
    if (typeof contamination === 'string') return contamination;
    if (contamination !== undefined) {
      if (contamination < 0 || contamination > 0.5) {
        return 'Contaminação precisa estar entre 0 e 0,5.';
      }
      body.contamination = contamination;
    }
  }

  if (input.analysis === 'recurring_causes') {
    const window_days = optionalInt(input.window_days, 'Janela em dias');
    if (typeof window_days === 'string') return window_days;
    if (window_days !== undefined) {
      if (window_days <= 0) return 'Janela em dias precisa ser positiva.';
      body.window_days = window_days;
    }
  }

  return body;
}
