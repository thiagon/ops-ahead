import { describe, expect, it } from 'vitest';
import { toIncidentStatus } from '../../../../src/modules/incidents/status.ts';

describe('toIncidentStatus', () => {
  it.each([
    ['Sem Intervenção', 'no_intervention'],
    ['Encerrado Automaticamente', 'auto_closed'],
    ['Encerrado', 'closed'],
    ['Aguardando Problema', 'awaiting_problem'],
  ])('translates %s to %s', (origin, expected) => {
    expect(toIncidentStatus(origin)).toBe(expected);
  });

  it('tolerates surrounding whitespace from the origin', () => {
    expect(toIncidentStatus('  Encerrado  ')).toBe('closed');
  });

  it('falls back to unknown for a status the dictionary does not carry', () => {
    expect(toIncidentStatus('Aguardando Terceiro')).toBe('unknown');
    expect(toIncidentStatus('')).toBe('unknown');
  });

  it('never lets the origin vocabulary through', () => {
    for (const origin of ['Sem Intervenção', 'Encerrado', 'Qualquer Coisa']) {
      expect(toIncidentStatus(origin)).not.toBe(origin);
    }
  });
});
