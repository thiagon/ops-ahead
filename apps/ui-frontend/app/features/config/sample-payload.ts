/**
 * A test POST body shaped like the origin's payload: each bound field is written
 * at the path the dictionary reads, using a mapped origin value when one exists.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export type SampleField = {
  field: string;
  type: 'string' | 'integer' | 'object';
  path: string | null;
  values: {
    rows: { domainValue: string; origins: { from: string }[] }[];
  } | null;
};

export const INTEGRATION_TABS = ['basic', 'dictionary', 'test'] as const;
export type IntegrationTab = (typeof INTEGRATION_TABS)[number];

export function parseIntegrationTab(value: string | null): IntegrationTab {
  return value === 'dictionary' || value === 'test' || value === 'basic' ? value : 'basic';
}

/** Nested write that refuses prototype-polluting keys. */
export function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0 || parts.some(part => FORBIDDEN_KEYS.has(part))) return;

  let cursor: Record<string, unknown> = target;
  for (const key of parts.slice(0, -1)) {
    const next = cursor[key];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts.at(-1) ?? ''] = value;
}

export function samplePayload(
  fields: readonly SampleField[],
  now = new Date(),
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (!field.path) continue;
    setAtPath(payload, field.path, sampleValue(field, now));
  }
  return payload;
}

function sampleValue(field: SampleField, now: Date): unknown {
  const mapped = field.values?.rows.find(row => row.origins.length > 0)?.origins[0]?.from;
  if (mapped !== undefined) {
    if (field.type === 'integer') {
      const numeric = Number(mapped);
      return Number.isFinite(numeric) ? numeric : mapped;
    }
    return mapped;
  }

  switch (field.field) {
    case 'external_id':
      return 'TEST-1';
    case 'opened_at':
    case 'started_at':
    case 'acknowledged_at':
    case 'resolved_at':
    case 'closed_at':
    case 'ended_at':
      return now.toISOString();
    case 'severity':
      return field.type === 'integer' ? 3 : '3';
    case 'status':
      return 'open';
    case 'condition':
      return 'firing';
    case 'entity_id':
      return 'app-1';
    case 'title':
      return 'Evento de teste';
    case 'description':
      return 'Enviado pela tela de integração.';
    case 'owner':
      return 'ops';
    case 'reported_by':
      return 'manual';
    case 'parent_id':
      return null;
    case 'resolution_code':
      return 'resolved';
    case 'resolution_summary':
      return 'Teste';
    case 'labels':
      return { origin: 'test' };
    case 'source_url':
      return 'https://example.local/TEST-1';
    default:
      if (field.type === 'integer') return 1;
      if (field.type === 'object') return {};
      return 'teste';
  }
}
