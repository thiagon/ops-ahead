import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigNotFoundError } from '../../../../src/modules/config/service.ts';
import { createTestApp } from '../../../helpers/app.ts';

const INTEGRATION = {
  source: 'itsm',
  intake: 'alert' as const,
  envelopeVersion: 'v1',
  secretCreatedAt: '2026-01-01T00:00:00.000Z',
  enabled: true,
  dictionaryVersion: 'v1',
  dictionaryStatus: 'published' as const,
  bindings: [{ field: 'external_id', path: 'ticket_number' }],
  mappings: {
    status: [{ id: '11111111-1111-4111-8111-111111111111', from: 'Encerrado', to: 'closed' }],
  },
};

describe('config routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp(instance => {
      instance.decorate('configService', {
        listIntegrations: async () => [INTEGRATION],
        getIntegration: async (_tenant: string, source: string) => {
          if (source !== 'itsm') throw new ConfigNotFoundError(`integration ${source} not found`);
          return INTEGRATION;
        },
        listDeadlines: async () => [{ severity: 1, deadlineSeconds: 14400 }],
        listKpiTargets: async () => [{ kpiGroup: 'p1_p2', maxBreaches: 39, achievementPct: 100 }],
        listRevisions: async () => [
          {
            id: '33333333-3333-4333-8333-333333333333',
            domain: 'dictionary' as const,
            summary: 'Encerrado → closed em status',
            author: 'anonymous',
            at: '2026-01-02T00:00:00.000Z',
          },
        ],
        replaceDeadlines: async (_tenant: string, items: unknown) => items,
      } as never);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists the tenant integrations with bindings and mappings embedded', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/locaweb/integrations' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [INTEGRATION] });
  });

  it('answers 404 for an integration the tenant does not have', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/locaweb/integrations/zabbix' });

    expect(res.statusCode).toBe(404);
  });

  it('serves the OLA deadlines and the KPI bands the screens read', async () => {
    const deadlines = await app.inject({ method: 'GET', url: '/tenants/locaweb/deadlines' });
    const targets = await app.inject({ method: 'GET', url: '/tenants/locaweb/kpi-targets' });

    expect(deadlines.json()).toEqual({ items: [{ severity: 1, deadlineSeconds: 14400 }] });
    expect(targets.json()).toEqual({
      items: [{ kpiGroup: 'p1_p2', maxBreaches: 39, achievementPct: 100 }],
    });
  });

  it('rejects a deadline outside the severity scale instead of storing it', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/tenants/locaweb/deadlines',
      payload: { items: [{ severity: 9, deadlineSeconds: 14400 }] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('serves the revision history most recent first', async () => {
    const res = await app.inject({ method: 'GET', url: '/tenants/locaweb/revisions' });

    expect(res.json().items[0].summary).toBe('Encerrado → closed em status');
  });
});
