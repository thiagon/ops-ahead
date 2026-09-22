/**
 * Reads GET /rules/schema so the screens do not keep a second copy of the
 * mapping / deadline / target contracts the gateway already validates.
 */

import type { ContractField, Intake } from './types.ts';

export type RulesContract = {
  fields: Record<Intake, ContractField[]>;
};

type JsonSchema = {
  type?: string;
  const?: unknown;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
  items?: JsonSchema;
};

function asSchema(value: unknown): JsonSchema | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonSchema;
}

function variantsOf(schema: JsonSchema): JsonSchema[] {
  if (schema.oneOf?.length) return schema.oneOf;
  if (schema.anyOf?.length) return schema.anyOf;
  return schema.properties ? [schema] : [];
}

function intakeOf(variant: JsonSchema): Intake | null {
  const value = variant.properties?.intake?.const;
  return value === 'alert' || value === 'monitor' ? value : null;
}

function isLabelsSchema(schema: JsonSchema): boolean {
  const variants = schema.anyOf ?? schema.oneOf ?? [];
  return variants.some(variant => variant.type === 'array');
}

function enumOf(schema: JsonSchema | undefined): string[] {
  const values = schema?.enum;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string');
}

function mappingTarget(schema: JsonSchema | undefined): {
  translated: boolean;
  domainValues: string[];
  mappingHint?: string;
} {
  if (!schema) return { translated: false, domainValues: [] };
  const additional =
    schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? schema.additionalProperties
      : undefined;
  return {
    translated: true,
    domainValues: enumOf(additional),
    mappingHint: schema.description,
  };
}

function fieldsFrom(variant: JsonSchema): ContractField[] {
  const bindings = variant.properties?.bindings;
  const mappings = variant.properties?.mappings?.properties ?? {};
  const required = new Set(bindings?.required ?? []);
  const properties = bindings?.properties ?? {};

  return Object.entries(properties).map(([field, schema]) => {
    const labels = isLabelsSchema(schema);
    const mapped = mappingTarget(mappings[field]);
    return {
      field,
      required: required.has(field),
      type: labels ? 'object' : 'string',
      hint: schema.description ?? '',
      mappingHint: mapped.mappingHint,
      translated: mapped.translated,
      kind: labels ? 'labels' : 'path',
      domainValues: mapped.domainValues,
    };
  });
}

export function parseRulesContract(body: unknown): RulesContract {
  const record = asSchema(body);
  if (!record) {
    throw new Error('O schema das regras não veio no formato esperado.');
  }

  const fields: RulesContract['fields'] = { alert: [], monitor: [] };
  const mapping =
    body && typeof body === 'object' && 'mapping' in body ? asSchema(body.mapping) : null;
  for (const variant of variantsOf(mapping ?? {})) {
    const intake = intakeOf(variant);
    if (!intake) continue;
    fields[intake] = fieldsFrom(variant);
  }

  if (fields.alert.length === 0 || fields.monitor.length === 0) {
    throw new Error('O schema das regras não descreve os dois intakes.');
  }

  return { fields };
}
