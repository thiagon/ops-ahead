/**
 * Shape of the configuration a tenant's pipeline runs on. The screens edit
 * it; the gateway is the registry — REST and MCP write the same records, and
 * data-ingest consumes what the gateway publishes.
 *
 * Field lists, required flags and value dictionaries come from GET
 * /rules/schema (the same Zod the gateway validates). This file keeps the
 * types and the presentation labels the screens need.
 */

export type ConfigDomain = 'origin' | 'dictionary' | 'deadline' | 'kpi_target';

export type Intake = 'alert' | 'monitor';

/** Lifecycle as the screens show it. The gateway's `disabled` is `inactive`. */
export type Status = 'active' | 'inactive' | 'archived';

export type LabelEntry = {
  key: string;
  path: string;
};

/**
 * Where one field of the translated contract is read in the origin's own
 * payload. What the dictionary does for values, this does for fields
 * (contracts/field-binding.schema.json).
 */
export type FieldBinding = {
  /** Field of incident-alert.schema.json / condition-monitor.schema.json. */
  field: string;
  /** Dotted path into the origin's payload, e.g. 'fields.status.name'. */
  path: string | null;
  /** `labels` may be several origin fields joined into a map instead. */
  labels?: readonly LabelEntry[] | null;
};

/**
 * What the contract says about a field — whether it is required, what it
 * carries, whether its values go through the dictionary. Built from the
 * gateway schema, never authored here.
 */
export type ContractField = {
  field: string;
  required: boolean;
  type: 'string' | 'integer' | 'object';
  hint: string;
  mappingHint?: string;
  /** Whether this field's values also go through the dictionary. */
  translated: boolean;
  kind: 'path' | 'labels';
  /** Empty and translated means the target is free-form (resolution_code). */
  domainValues: readonly string[];
};

/** One origin value mapped to one domain value, e.g. 'Encerrado' → 'closed'. */
export type MappingEntry = {
  from: string;
  to: string;
};

export type MappingField = string;

export type Deadline = {
  severity: number;
  deadlineSeconds: number;
};

export type KpiTarget = {
  severities: number[];
  maxBreaches: number;
  achievementPct: number;
};

export function kpiGroupKey(severities: readonly number[]): string {
  return [...severities].sort((a, b) => a - b).join(',');
}

export function formatKpiGroup(severities: readonly number[]): string {
  return [...severities]
    .sort((a, b) => a - b)
    .map(severity => `P${severity}`)
    .join(' + ');
}

export function isBound(binding: FieldBinding): boolean {
  if (binding.labels?.some(entry => entry.key && entry.path)) return true;
  return Boolean(binding.path);
}

/** Gaps against the contract — the vocabulary lives in the gateway schema. */
export function integrationGaps(input: {
  fields: readonly ContractField[];
  bindings: readonly FieldBinding[];
  mappings: Partial<Record<string, readonly { to: string }[]>>;
}): { missingFields: number; uncovered: number } {
  const bound = new Map(input.bindings.map(binding => [binding.field, binding]));
  const missingFields = input.fields.filter(field => {
    const binding = bound.get(field.field) ?? { field: field.field, path: null };
    return field.required && !isBound(binding);
  }).length;

  let uncovered = 0;
  for (const field of input.fields) {
    if (!field.translated || field.domainValues.length === 0) continue;
    const mapped = new Set((input.mappings[field.field] ?? []).map(entry => entry.to));
    uncovered += field.domainValues.filter(value => !mapped.has(value)).length;
  }
  return { missingFields, uncovered };
}

export function isIntegrationReady(input: {
  fields: readonly ContractField[];
  bindings: readonly FieldBinding[];
  mappings: Partial<Record<string, readonly { to: string }[]>>;
}): boolean {
  const { missingFields, uncovered } = integrationGaps(input);
  return missingFields === 0 && uncovered === 0;
}

export function parseBindingsForm(form: FormData): FieldBinding[] {
  const fields = form.getAll('field').map(String);
  const paths = form.getAll('path').map(value => String(value).trim() || null);
  const entries = form
    .getAll('label_key')
    .map((key, index) => ({
      key: String(key).trim(),
      path: String(form.getAll('label_path')[index] ?? '').trim(),
    }))
    .filter(entry => entry.key.length > 0 && entry.path.length > 0);

  return fields.map((field, index) => {
    if (field === 'labels' && entries.length > 0) {
      return { field, path: null, labels: entries };
    }
    return { field, path: paths[index] ?? null, labels: null };
  });
}

export const SEVERITY_VALUE_LABEL: Record<string, string> = {
  '1': 'Crítica',
  '2': 'Alta',
  '3': 'Média',
  '4': 'Baixa',
  '5': 'Muito baixa',
};

/** 'intake' is our word, not the customer's — these screens say what it means. */
export const INTAKE_LABEL: Record<Intake, string> = {
  alert: 'Monitor',
  monitor: 'Sinais',
};

export const INTAKE_HINT: Record<Intake, string> = {
  alert: 'ServiceNow e ITSM. Métricas e previsão entram em cima.',
  monitor: 'Prometheus, Zabbix e afins.',
};

export const SEVERITY_LABEL: Record<number, string> = {
  1: 'P1 — Crítica',
  2: 'P2 — Alta',
  3: 'P3 — Média',
  4: 'P4 — Baixa',
  5: 'P5 — Muito baixa',
};

export const KNOWN_SEVERITIES = Object.keys(SEVERITY_LABEL)
  .map(Number)
  .sort((a, b) => a - b);

export function severityLabel(severity: number): string {
  return SEVERITY_LABEL[severity] ?? `P${severity}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.round(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? '1 dia' : `${days} dias`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}min`);
  if (rest) parts.push(`${rest}s`);
  return parts.join(' ');
}

export function webhookUrl(base: string, tenantSlug: string, source: string): string {
  return `${base.replace(/\/+$/, '')}/webhook/${tenantSlug}/${source}`;
}
