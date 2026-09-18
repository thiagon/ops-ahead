import { describe, expect, it } from 'vitest';
import {
  parseIntegrationTab,
  samplePayload,
  setAtPath,
  type SampleField,
} from '../app/features/config/sample-payload.ts';

describe('parseIntegrationTab', () => {
  it('keeps a known tab and falls back to basic otherwise', () => {
    expect(parseIntegrationTab('dictionary')).toBe('dictionary');
    expect(parseIntegrationTab('test')).toBe('test');
    expect(parseIntegrationTab('basic')).toBe('basic');
    expect(parseIntegrationTab(null)).toBe('basic');
    expect(parseIntegrationTab('envio')).toBe('basic');
  });
});

describe('setAtPath', () => {
  it('writes a nested dotted path without clobbering siblings', () => {
    const target: Record<string, unknown> = {};
    setAtPath(target, 'fields.status.name', 'Encerrado');
    setAtPath(target, 'fields.status.code', 7);
    expect(target).toEqual({ fields: { status: { name: 'Encerrado', code: 7 } } });
  });

  it('ignores prototype-polluting keys', () => {
    const target: Record<string, unknown> = {};
    setAtPath(target, '__proto__.polluted', true);
    setAtPath(target, 'constructor.prototype.x', 1);
    expect(Object.hasOwn(target, 'polluted')).toBe(false);
    expect(Object.hasOwn(target, 'constructor')).toBe(false);
  });
});

describe('samplePayload', () => {
  const now = new Date('2026-09-18T15:00:00.000Z');

  it('places each bound field at its origin path', () => {
    const fields: SampleField[] = [
      { field: 'external_id', type: 'string', path: 'ticket_number', values: null },
      { field: 'opened_at', type: 'string', path: 'opened_at', values: null },
      { field: 'title', type: 'string', path: 'short_description', values: null },
      { field: 'description', type: 'string', path: null, values: null },
    ];

    expect(samplePayload(fields, now)).toEqual({
      ticket_number: 'TEST-1',
      opened_at: '2026-09-18T15:00:00.000Z',
      short_description: 'Evento de teste',
    });
  });

  it('prefers a mapped origin value, as an integer when the contract says so', () => {
    const fields: SampleField[] = [
      {
        field: 'severity',
        type: 'integer',
        path: 'priority_code',
        values: {
          rows: [
            { domainValue: '1', origins: [] },
            { domainValue: '2', origins: [{ from: '2' }] },
          ],
        },
      },
      {
        field: 'status',
        type: 'string',
        path: 'status',
        values: {
          rows: [{ domainValue: 'closed', origins: [{ from: 'Encerrado' }] }],
        },
      },
    ];

    expect(samplePayload(fields, now)).toEqual({
      priority_code: 2,
      status: 'Encerrado',
    });
  });
});
