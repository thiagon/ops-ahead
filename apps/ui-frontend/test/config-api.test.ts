import { describe, expect, it } from 'vitest';
import {
  ConfigApiError,
  getIntegration,
  listDeadlines,
  listIntegrations,
  listKpiTargets,
} from '../app/features/config/api.server.ts';
import {
  DOMAIN_VALUES,
  formatDuration,
  MAPPED_FIELDS,
  type MappingField,
} from '../app/features/config/types.ts';

describe('formatDuration', () => {
  it('reads whole days as days and everything else as hours', () => {
    expect(formatDuration(14400)).toBe('4h');
    expect(formatDuration(43200)).toBe('12h');
    expect(formatDuration(86400)).toBe('1 dia');
    expect(formatDuration(345600)).toBe('4 dias');
  });
});

describe('mapped fields', () => {
  it('keeps each intake to the vocabulary its contract carries', () => {
    expect(MAPPED_FIELDS.alert).toContain('status');
    expect(MAPPED_FIELDS.alert).not.toContain('condition');
    expect(MAPPED_FIELDS.monitor).toContain('condition');
    expect(MAPPED_FIELDS.monitor).not.toContain('status');
  });

  it('translates severity on both, since each origin grades on its own scale', () => {
    expect(MAPPED_FIELDS.alert).toContain('severity');
    expect(MAPPED_FIELDS.monitor).toContain('severity');
    expect(DOMAIN_VALUES.severity).toEqual(['1', '2', '3', '4', '5']);
  });

  it('leaves resolution_code free-form and constrains every other target', () => {
    expect(DOMAIN_VALUES.resolution_code).toHaveLength(0);
    expect(DOMAIN_VALUES.condition).toEqual(['firing', 'cleared']);
    expect(DOMAIN_VALUES.status.length).toBeGreaterThan(0);
  });
});

describe('config api', async () => {
  const integrations = await listIntegrations();

  it('carries the OLA deadlines the data dictionary defines', async () => {
    const deadlines = await listDeadlines();
    const bySeverity = new Map(deadlines.map(d => [d.severity, d.deadlineSeconds]));
    expect(bySeverity.get(1)).toBe(14400);
    expect(bySeverity.get(2)).toBe(14400);
    expect(bySeverity.get(3)).toBe(43200);
    expect(bySeverity.get(4)).toBe(86400);
    expect(bySeverity.get(5)).toBe(345600);
  });

  it('answers 404 for an integration that does not exist', async () => {
    await expect(getIntegration('nope')).rejects.toThrow(ConfigApiError);
    await expect(getIntegration('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('returns each integration with its bindings and mappings inlined', async () => {
    for (const listed of integrations) {
      const one = await getIntegration(listed.source);
      expect(one.source).toBe(listed.source);
      expect(one.bindings.length).toBeGreaterThan(0);
    }
  });

  it('never exposes the signing secret, only when it was issued', () => {
    for (const integration of integrations) {
      expect(Object.keys(integration)).not.toContain('secret');
      expect(Date.parse(integration.secretCreatedAt)).not.toBeNaN();
    }
  });

  it('maps only the fields its intake translates', () => {
    for (const integration of integrations) {
      const allowed = MAPPED_FIELDS[integration.intake];
      for (const field of Object.keys(integration.mappings) as MappingField[]) {
        expect(allowed, `${integration.source} maps ${field}`).toContain(field);
      }
    }
  });

  it('only ever targets a value the domain knows', () => {
    for (const integration of integrations) {
      for (const [field, entries] of Object.entries(integration.mappings)) {
        const known = DOMAIN_VALUES[field as MappingField];
        if (known.length === 0) continue;
        for (const entry of entries) expect(known).toContain(entry.to);
      }
    }
  });

  it('gives every mapping a key that survives editing either side', () => {
    for (const integration of integrations) {
      const ids = Object.values(integration.mappings)
        .flat()
        .map(entry => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('marks as translated exactly the fields its intake maps', () => {
    for (const integration of integrations) {
      const translated = integration.bindings
        .filter(binding => binding.translated)
        .map(binding => binding.field);
      expect([...translated].sort()).toEqual([...MAPPED_FIELDS[integration.intake]].sort());
    }
  });

  it('reports the KPI target bands as ordered bands', async () => {
    const targets = await listKpiTargets();
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.achievementPct).toBeGreaterThanOrEqual(0);
      expect(target.maxBreaches).toBeGreaterThan(0);
    }
  });
});
