/**
 * Shape of the configuration a tenant's pipeline runs on. Mirrors what today
 * lives as files next to the consumers — the translation dictionary
 * (apps/data-ingest/dictionaries/), and the dbt seeds tenant_deadlines.csv and
 * tenant_kpi_targets.csv — plus the origin credentials registry the gateway
 * carries in code. The screen edits these; publishing them to the consumers is
 * a later step.
 */

export type ConfigDomain = 'origin' | 'dictionary' | 'deadline' | 'kpi_target';

export type Intake = 'alert' | 'monitor';

/** Same values as the Prisma `Status` enum — the client never imports that module. */
export type Status = 'active' | 'inactive' | 'archived';

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
};

/**
 * What the contract says about a field — whether it is required, what it
 * carries, whether its values go through the dictionary. It describes the
 * domain, not the tenant, so it is never configuration and never travels on
 * the wire: the screen reads it here and the API answers paths alone.
 */
export type ContractField = {
  field: string;
  required: boolean;
  type: 'string' | 'integer' | 'object';
  hint: string;
  /** Whether this field's values also go through the dictionary. */
  translated: boolean;
};

export const CONTRACT_FIELDS: Record<Intake, readonly ContractField[]> = {
  monitor: [
    {
      field: 'external_id',
      required: true,
      type: 'string',
      hint: 'Identidade na origem, como o número do chamado.',
      translated: false,
    },
    {
      field: 'opened_at',
      required: true,
      type: 'string',
      hint: 'Quando foi aberto.',
      translated: false,
    },
    {
      field: 'acknowledged_at',
      required: false,
      type: 'string',
      hint: 'Quando alguém assumiu.',
      translated: false,
    },
    {
      field: 'resolved_at',
      required: false,
      type: 'string',
      hint: 'Quando a causa foi resolvida.',
      translated: false,
    },
    {
      field: 'closed_at',
      required: false,
      type: 'string',
      hint: 'Quando foi encerrado.',
      translated: false,
    },
    {
      field: 'severity',
      required: true,
      type: 'integer',
      hint: 'Prioridade na escala da origem.',
      translated: true,
    },
    { field: 'status', required: true, type: 'string', hint: 'Situação atual.', translated: true },
    {
      field: 'entity_id',
      required: false,
      type: 'string',
      hint: 'O que foi afetado.',
      translated: false,
    },
    {
      field: 'title',
      required: true,
      type: 'string',
      hint: 'Resumo em uma linha.',
      translated: false,
    },
    {
      field: 'description',
      required: false,
      type: 'string',
      hint: 'Descrição completa.',
      translated: false,
    },
    {
      field: 'owner',
      required: false,
      type: 'string',
      hint: 'Quem atende agora.',
      translated: false,
    },
    {
      field: 'reported_by',
      required: false,
      type: 'string',
      hint: 'Como foi aberto.',
      translated: true,
    },
    {
      field: 'parent_id',
      required: false,
      type: 'string',
      hint: 'Chamado pai, quando houver.',
      translated: false,
    },
    {
      field: 'resolution_code',
      required: false,
      type: 'string',
      hint: 'Desfecho do encerramento.',
      translated: true,
    },
    {
      field: 'resolution_summary',
      required: false,
      type: 'string',
      hint: 'O que foi feito.',
      translated: false,
    },
    {
      field: 'labels',
      required: false,
      type: 'object',
      hint: 'Produto, categoria e afins.',
      translated: false,
    },
    {
      field: 'source_url',
      required: false,
      type: 'string',
      hint: 'Link para o chamado na origem.',
      translated: false,
    },
  ],
  alert: [
    {
      field: 'external_id',
      required: true,
      type: 'string',
      hint: 'Identidade na origem.',
      translated: false,
    },
    {
      field: 'started_at',
      required: true,
      type: 'string',
      hint: 'Quando a condição disparou.',
      translated: false,
    },
    {
      field: 'ended_at',
      required: false,
      type: 'string',
      hint: 'Quando normalizou.',
      translated: false,
    },
    {
      field: 'severity',
      required: false,
      type: 'integer',
      hint: 'Gravidade na escala da origem.',
      translated: true,
    },
    {
      field: 'condition',
      required: true,
      type: 'string',
      hint: 'Disparada ou normalizada.',
      translated: true,
    },
    {
      field: 'entity_id',
      required: true,
      type: 'string',
      hint: 'O que está sendo monitorado.',
      translated: false,
    },
    {
      field: 'title',
      required: false,
      type: 'string',
      hint: 'Resumo em uma linha.',
      translated: false,
    },
    {
      field: 'description',
      required: false,
      type: 'string',
      hint: 'Descrição completa.',
      translated: false,
    },
    {
      field: 'labels',
      required: false,
      type: 'object',
      hint: 'Rótulos adicionais.',
      translated: false,
    },
    {
      field: 'source_url',
      required: false,
      type: 'string',
      hint: 'Link para o sinal na origem.',
      translated: false,
    },
  ],
};

/** One origin value mapped to one domain value, e.g. 'Encerrado' → 'closed'. */
export type MappingEntry = {
  /** Surrogate id of the row — removing one must not reshuffle the others. */
  id: number;
  from: string;
  to: string;
};

/** The mapping keys a dictionary can carry. Which ones apply is decided by the
    origin's intake — see MAPPED_FIELDS. */
export type MappingField = 'status' | 'severity' | 'reported_by' | 'resolution_code' | 'condition';

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

/**
 * What each intake translates. Monitor carries a lifecycle; Sinais only
 * says whether a condition is firing or cleared — so the two never share a
 * mapping key (contracts/translation-dictionary.schema.json).
 */
export const MAPPED_FIELDS: Record<Intake, readonly MappingField[]> = {
  monitor: ['status', 'severity', 'reported_by', 'resolution_code'],
  alert: ['condition', 'severity'],
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

/** Gaps against the contract — the vocabulary lives in code, not in the tenant row. */
export function integrationGaps(input: {
  intake: Intake;
  bindings: readonly FieldBinding[];
  mappings: Partial<Record<MappingField, readonly { to: string }[]>>;
}): { missingFields: number; uncovered: number } {
  const bound = new Map(input.bindings.map(binding => [binding.field, binding.path]));
  const missingFields = CONTRACT_FIELDS[input.intake].filter(
    field => field.required && !bound.get(field.field),
  ).length;

  let uncovered = 0;
  for (const field of CONTRACT_FIELDS[input.intake]) {
    if (!field.translated) continue;
    const known = DOMAIN_VALUES[field.field as MappingField];
    if (known.length === 0) continue;
    const mapped = new Set(
      (input.mappings[field.field as MappingField] ?? []).map(entry => entry.to),
    );
    uncovered += known.filter(value => !mapped.has(value)).length;
  }
  return { missingFields, uncovered };
}

export function isIntegrationReady(input: {
  intake: Intake;
  bindings: readonly FieldBinding[];
  mappings: Partial<Record<MappingField, readonly { to: string }[]>>;
}): boolean {
  const { missingFields, uncovered } = integrationGaps(input);
  return missingFields === 0 && uncovered === 0;
}

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
  monitor: 'Monitor',
  alert: 'Sinais',
};

export const INTAKE_HINT: Record<Intake, string> = {
  monitor: 'ServiceNow e ITSM. Métricas e previsão entram em cima.',
  alert: 'Prometheus, Zabbix e afins.',
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

export function webhookUrl(
  base: string,
  envelopeVersion: string,
  tenantSlug: string,
  source: string,
): string {
  return `${base.replace(/\/+$/, '')}/webhook/${envelopeVersion}/${tenantSlug}/${source}`;
}
