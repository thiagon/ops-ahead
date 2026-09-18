import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigApiError,
  getIntegration,
  listDeadlines,
  listIntegrations,
  rollbackRevision,
  upsertMapping,
} from '../app/features/config/api.server.ts';
import {
  CONTRACT_FIELDS,
  DOMAIN_VALUES,
  formatDuration,
  MAPPED_FIELDS,
} from '../app/features/config/types.ts';

/** Answers whatever the call under test asks for; no service is reachable here. */
function stubApi(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_input: Request | string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('contract fields', () => {
  it('marks as translated exactly the fields its intake maps', () => {
    for (const intake of ['alert', 'monitor'] as const) {
      const translated = CONTRACT_FIELDS[intake]
        .filter(field => field.translated)
        .map(field => field.field);
      expect([...translated].sort()).toEqual([...MAPPED_FIELDS[intake]].sort());
    }
  });

  it('carries every bindable field of each contract', () => {
    // The pipeline stamps event_id, tenant_id, source, version,
    // dictionary_version and received_at, so they are never bound here.
    expect(CONTRACT_FIELDS.alert).toHaveLength(17);
    expect(CONTRACT_FIELDS.monitor).toHaveLength(10);
  });
});

describe('config api', () => {
  it('addresses the configured tenant, never one the caller picks', async () => {
    const fetchMock = stubApi(200, { items: [] });

    await listIntegrations();

    const request = fetchMock.mock.calls[0]?.[0] as unknown as Request;
    expect(new URL(request.url).pathname).toBe('/tenants/locaweb/integrations');
  });

  it('carries the OLA deadlines the data dictionary defines', async () => {
    stubApi(200, {
      items: [
        { severity: 1, deadlineSeconds: 14400 },
        { severity: 3, deadlineSeconds: 43200 },
      ],
    });

    const bySeverity = new Map((await listDeadlines()).map(d => [d.severity, d.deadlineSeconds]));

    expect(bySeverity.get(1)).toBe(14400);
    expect(bySeverity.get(3)).toBe(43200);
  });

  it('surfaces a 404 as an error carrying the status, not as an empty answer', async () => {
    stubApi(404, { detail: 'integration nope not found' });

    await expect(getIntegration('nope')).rejects.toThrow(ConfigApiError);
    await expect(getIntegration('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('accepts a 204 from a write that returns nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    // Rollback changes state and answers no body; parsing it would throw.
    await expect(rollbackRevision('11111111-1111-4111-8111-111111111111')).resolves.toBeUndefined();
  });

  it('sends a mapping as a JSON body the API can validate', async () => {
    const fetchMock = stubApi(200, {});

    await upsertMapping('itsm', { field: 'status', from: 'Encerrado', to: 'closed' });

    const request = fetchMock.mock.calls[0]?.[0] as unknown as Request;
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.json()).toEqual({ field: 'status', from: 'Encerrado', to: 'closed' });
  });
});
