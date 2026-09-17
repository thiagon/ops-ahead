/**
 * Shape of the configuration a tenant's pipeline runs on. Mirrors what today
 * lives as files next to the consumers — the translation dictionary
 * (apps/data-ingest/dictionaries/), and the dbt seeds tenant_deadlines.csv and
 * tenant_kpi_targets.csv — plus the origin credentials registry the gateway
 * carries in code. The screen edits these; publishing them to the consumers is
 * a later step.
 */

export type ConfigDomain = 'origin' | 'dictionary' | 'deadline' | 'kpi_target';

/** Identifies an origin everywhere it is addressed — URL, key, revision. */
export function originKey(tenantId: string, source: string): string {
  return `${tenantId}:${source}`;
}

export type ConfigStatus = 'published' | 'draft';

export type Origin = {
  tenantId: string;
  /** The origin system itself, e.g. 'service_now' — not its category. */
  source: string;
  intake: Intake;
  envelopeVersion: string;
  /** Shown once when generated or rotated, then never readable again. */
  secretCreatedAt: string;
  enabled: boolean;
};

/**
 * One field of a translated contract and where it is read from in the origin's
 * own payload. What the dictionary does for values, this does for fields:
 * without it an origin can only be added in code (apps/data-ingest/src/sources/).
 */
export type FieldBinding = {
  /** Field of incident-alert.schema.json / condition-monitor.schema.json. */
  field: string;
  /** Dotted path into the origin's payload, e.g. 'fields.status.name'. */
  path: string | null;
  required: boolean;
  type: 'string' | 'integer' | 'object';
  hint: string;
  /** Whether this field's values also go through the dictionary. */
  translated: boolean;
};

/** One origin value mapped to one domain value, e.g. 'Encerrado' → 'closed'. */
export type MappingEntry = {
  /** Stable across edits: both sides of the pair are editable, so neither
      identifies the row, and removing one must not reshuffle the others. */
  id: string;
  from: string;
  to: string;
};

export type Intake = 'alert' | 'monitor';

/** The mapping keys a dictionary can carry. Which ones apply is decided by the
    origin's intake — see MAPPED_FIELDS. */
export type MappingField = 'status' | 'severity' | 'reported_by' | 'resolution_code' | 'condition';

export type Dictionary = {
  tenantId: string;
  source: string;
  intake: Intake;
  version: string;
  status: ConfigStatus;
  mappings: Partial<Record<MappingField, MappingEntry[]>>;
};

export type Deadline = {
  tenantId: string;
  severity: number;
  deadlineSeconds: number;
};

export type KpiTarget = {
  tenantId: string;
  kpiGroup: string;
  maxBreaches: number;
  achievementPct: number;
};

export type ConfigRevision = {
  id: string;
  domain: ConfigDomain;
  tenantId: string;
  summary: string;
  author: string;
  at: string;
};

export type FieldMap = {
  tenantId: string;
  source: string;
  bindings: FieldBinding[];
};

export type ConfigCatalog = {
  origins: Origin[];
  fieldMaps: FieldMap[];
  dictionaries: Dictionary[];
  deadlines: Deadline[];
  kpiTargets: KpiTarget[];
  revisions: ConfigRevision[];
};

/**
 * What each intake translates. An alert carries a lifecycle; a monitor only
 * says whether a condition is firing or cleared — so the two never share a
 * mapping key (contracts/translation-dictionary.schema.json).
 */
export const MAPPED_FIELDS: Record<Intake, readonly MappingField[]> = {
  alert: ['status', 'severity', 'reported_by', 'resolution_code'],
  monitor: ['condition', 'severity'],
};

export const DOMAIN_VALUES: Record<MappingField, readonly string[]> = {
  status: ['open', 'in_progress', 'waiting', 'resolved', 'closed', 'canceled'],
  // The origin grades severity on its own scale, so the label it sends is
  // translated like any other vocabulary (domain/acl/itsm.md).
  severity: ['1', '2', '3', '4', '5'],
  reported_by: ['automatic', 'manual'],
  condition: ['firing', 'cleared'],
  /** Free-form: an unmapped resolution code passes through untranslated. */
  resolution_code: [],
};

export const SEVERITY_VALUE_LABEL: Record<string, string> = {
  '1': 'Crítica',
  '2': 'Alta',
  '3': 'Média',
  '4': 'Baixa',
  '5': 'Muito baixa',
};

export const FIELD_HINT: Record<MappingField, string> = {
  status: 'Ciclo de vida da ocorrência. Um valor fora do mapa vira unknown.',
  severity: 'A escala da origem traduzida para a nossa.',
  reported_by: 'Como a ocorrência foi aberta.',
  resolution_code: 'Motivo do encerramento. Um valor fora do mapa passa sem tradução.',
  condition: 'Se a condição está disparada ou normalizada.',
};

/** 'intake' is our word, not the customer's — these screens say what it means. */
export const INTAKE_LABEL: Record<Intake, string> = {
  alert: 'Chamados',
  monitor: 'Sinais de monitoração',
};

export const INTAKE_HINT: Record<Intake, string> = {
  alert: 'Chamados que abrem, são atendidos e encerram.',
  monitor: 'Avisos que disparam quando algo sai do normal e cessam quando volta.',
};

export const SEVERITY_LABEL: Record<number, string> = {
  1: 'P1 — Crítica',
  2: 'P2 — Alta',
  3: 'P3 — Média',
  4: 'P4 — Baixa',
  5: 'P5 — Muito baixa',
};

export function formatDuration(seconds: number): string {
  const hours = seconds / 3600;
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  return `${hours}h`;
}

export function webhookUrl(
  base: string,
  envelopeVersion: string,
  tenantId: string,
  source: string,
): string {
  return `${base.replace(/\/+$/, '')}/webhook/${envelopeVersion}/${tenantId}/${source}`;
}
