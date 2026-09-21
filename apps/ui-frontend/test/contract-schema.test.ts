import { describe, expect, it } from 'vitest';
import { parseRulesContract } from '../app/features/config/contract-schema.ts';
import { parseBindingsForm } from '../app/features/config/types.ts';
import { RULES_SCHEMA } from './fixtures/rules-schema.ts';

describe('parseRulesContract', () => {
  it('reads required fields, mapping enums and labels from the gateway schema', () => {
    const contract = parseRulesContract(RULES_SCHEMA);
    const alert = Object.fromEntries(contract.fields.alert.map(field => [field.field, field]));
    const monitor = Object.fromEntries(contract.fields.monitor.map(field => [field.field, field]));

    expect(alert.external_id?.required).toBe(true);
    expect(alert.status?.translated).toBe(true);
    expect(alert.status?.domainValues).toEqual([
      'open',
      'in_progress',
      'waiting',
      'resolved',
      'closed',
      'canceled',
    ]);
    expect(alert.labels?.kind).toBe('labels');
    expect(alert.resolution_code?.translated).toBe(true);
    expect(alert.resolution_code?.domainValues).toEqual([]);
    expect(monitor.condition?.domainValues).toEqual(['firing', 'cleared']);
    expect(monitor.entity_id?.required).toBe(true);
  });

  it('rejects a payload that is not the gateway schema', () => {
    expect(() => parseRulesContract(null)).toThrow(/schema/);
    expect(() => parseRulesContract({ mapping: {} })).toThrow(/intakes/);
  });
});

describe('parseBindingsForm', () => {
  it('keeps labels as key/path pairs when those fields are present', () => {
    const form = new FormData();
    form.append('field', 'external_id');
    form.append('path', 'number');
    form.append('field', 'labels');
    form.append('path', '');
    form.append('label_key', 'product');
    form.append('label_path', 'fields.product');

    expect(parseBindingsForm(form)).toEqual([
      { field: 'external_id', path: 'number', labels: null },
      {
        field: 'labels',
        path: null,
        labels: [{ key: 'product', path: 'fields.product' }],
      },
    ]);
  });
});
