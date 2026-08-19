import { describe, expect, it } from 'vitest';
import { toIncidentEvent } from '../../../../../src/modules/incidents/sources/itsm.ts';

const post = (overrides: Record<string, unknown> = {}) =>
  toIncidentEvent({
    source: 'itsm',
    ticket_number: 'INC0012345',
    opened_at: '2025-12-31 23:45:18',
    priority_code: 2,
    configuration_item: 'srv-web-04',
    status: 'Encerrado',
    opened_by: 'Monitoramento',
    payload: {},
    ...overrides,
  });

describe('itsm adapter', () => {
  it.each([
    ['Sem Intervenção', 'no_intervention'],
    ['Encerrado Automaticamente', 'auto_closed'],
    ['Encerrado', 'closed'],
    ['Aguardando Problema', 'awaiting_problem'],
  ])('translates the %s status to %s', (origin, expected) => {
    expect(post({ status: origin }).status).toBe(expected);
  });

  it.each([
    ['Monitoramento', 'monitoring'],
    ['Manual', 'manual'],
  ])('translates opened_by %s to %s', (origin, expected) => {
    expect(post({ opened_by: origin }).opened_by).toBe(expected);
  });

  it('tolerates surrounding whitespace from the origin', () => {
    expect(post({ status: '  Encerrado  ' }).status).toBe('closed');
  });

  it('falls back to unknown for words the dictionary does not carry', () => {
    expect(post({ status: 'Aguardando Terceiro' }).status).toBe('unknown');
    expect(post({ status: '' }).status).toBe('unknown');
    expect(post({ opened_by: 'Automático' }).opened_by).toBe('unknown');
  });

  it('never lets the origin vocabulary reach the published event', () => {
    for (const origin of ['Sem Intervenção', 'Encerrado', 'Qualquer Coisa']) {
      expect(post({ status: origin }).status).not.toBe(origin);
    }
  });
});
