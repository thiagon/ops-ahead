import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  createIntegration,
  getIntegration,
  listDeadlines,
  listIntegrations,
  listKpiTargets,
  listRevisions,
  NotFoundError,
  removeMapping,
  replaceDeadlines,
  replaceKpiTargets,
  rollback,
  updateBindings,
  upsertMapping,
  withTenant,
} from '../app/features/config/repo.server.ts';
import type { Intake } from '../app/features/config/types.ts';
import { RULES_SCHEMA } from './fixtures/rules-schema.ts';

const REQUEST = new Request('http://ui.example/locaweb', {
  headers: { cookie: 'oa_session=sealed' },
});

function asTenant<T>(fn: () => Promise<T>): Promise<T> {
  return withTenant(REQUEST, 'locaweb', fn);
}

type SourceRow = {
  tenant_id: string;
  source: string;
  intake: Intake;
  status: 'active' | 'disabled';
};

type MappingDoc = {
  intake: Intake;
  version: string;
  bindings: Record<string, unknown>;
  mappings: Record<string, Record<string, string>>;
};

type Stored<T> = T & { id: number; created_at: string };

function installFakeGateway() {
  const sources: SourceRow[] = [];
  const secrets = new Map<string, string>();
  const mappings = new Map<string, MappingDoc>();
  const mappingHistory: Stored<MappingDoc>[] = [];
  let deadlines: { deadlines: { severity: number; seconds: number }[] } | null = null;
  const deadlineHistory: Stored<{ deadlines: { severity: number; seconds: number }[] }>[] = [];
  let targets: {
    targets: { severities: number[]; max_breaches: number; achievement_pct: number }[];
  } | null = null;
  const targetHistory: Stored<{
    targets: { severities: number[]; max_breaches: number; achievement_pct: number }[];
  }>[] = [];
  let nextId = 1;
  let now = 0;

  const stamp = () => new Date(1_700_000_000_000 + now++ * 1000).toISOString();

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const path = url.pathname;

      const sourceMatch = path.match(/^\/sources\/([^/]+)(?:\/([^/]+))?(?:\/(status|secret))?$/);
      if (sourceMatch) {
        const tenant = decodeURIComponent(sourceMatch[1] ?? '');
        const source = sourceMatch[2] ? decodeURIComponent(sourceMatch[2]) : undefined;
        const extra = sourceMatch[3];

        if (method === 'GET' && !source) {
          return Response.json(sources.filter(row => row.tenant_id === tenant));
        }
        if (!source) return new Response(null, { status: 404 });

        if (method === 'PUT' && extra === 'status') {
          const row = sources.find(item => item.tenant_id === tenant && item.source === source);
          if (!row)
            return Response.json({ error: 'NotFound', message: 'missing' }, { status: 404 });
          row.status = body.status;
          return Response.json(row);
        }
        if (method === 'POST' && extra === 'secret') {
          const row = sources.find(item => item.tenant_id === tenant && item.source === source);
          if (!row)
            return Response.json({ error: 'NotFound', message: 'missing' }, { status: 404 });
          const secret = 'rotated-secret-value-000000000000';
          secrets.set(`${tenant}:${source}`, secret);
          return Response.json({ source: row, secret });
        }
        if (method === 'PUT') {
          const secret = 'minted-secret-value-0000000000000';
          let row = sources.find(item => item.tenant_id === tenant && item.source === source);
          if (!row) {
            row = {
              tenant_id: tenant,
              source,
              intake: body.intake,
              status: 'active',
            };
            sources.push(row);
          }
          secrets.set(`${tenant}:${source}`, secret);
          return Response.json({ source: row, secret });
        }
      }

      if (path === '/rules/schema') {
        return Response.json(RULES_SCHEMA);
      }

      const mappingMatch = path.match(/^\/rules\/mappings\/([^/]+)\/([^/]+)(\/history)?$/);
      if (mappingMatch) {
        const tenant = decodeURIComponent(mappingMatch[1] ?? '');
        const source = decodeURIComponent(mappingMatch[2] ?? '');
        const key = `${tenant}:${source}`;
        if (mappingMatch[3]) {
          return Response.json(
            mappingHistory
              .filter(item => item.intake && key)
              .slice()
              .reverse(),
          );
        }
        if (method === 'GET') {
          const document = mappings.get(key);
          if (!document) return new Response(null, { status: 404 });
          return Response.json(document);
        }
        if (method === 'PUT') {
          mappings.set(key, body);
          mappingHistory.push({ ...body, id: nextId++, created_at: stamp() });
          return Response.json({ key, topic: 'rules.mapping' }, { status: 202 });
        }
      }

      const deadlineMatch = path.match(/^\/rules\/deadlines\/([^/]+)(\/history)?$/);
      if (deadlineMatch) {
        if (deadlineMatch[2]) return Response.json([...deadlineHistory].reverse());
        if (method === 'GET') {
          if (!deadlines) return new Response(null, { status: 404 });
          return Response.json(deadlines);
        }
        if (method === 'PUT') {
          deadlines = body;
          deadlineHistory.push({ ...body, id: nextId++, created_at: stamp() });
          return Response.json({ key: 'locaweb', topic: 'rules.deadline' }, { status: 202 });
        }
      }

      const targetMatch = path.match(/^\/rules\/targets\/([^/]+)(\/history)?$/);
      if (targetMatch) {
        if (targetMatch[2]) return Response.json([...targetHistory].reverse());
        if (method === 'GET') {
          if (!targets) return new Response(null, { status: 404 });
          return Response.json(targets);
        }
        if (method === 'PUT') {
          targets = body;
          targetHistory.push({ ...body, id: nextId++, created_at: stamp() });
          return Response.json({ key: 'locaweb', topic: 'rules.target' }, { status: 202 });
        }
      }

      return new Response(null, { status: 404 });
    }),
  );
}

beforeEach(() => {
  installFakeGateway();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REQUIRED_ALERT_BINDINGS = [
  { field: 'external_id', path: 'number' },
  { field: 'opened_at', path: 'opened_at' },
  { field: 'severity', path: 'priority' },
  { field: 'status', path: 'state' },
  { field: 'title', path: 'short_description' },
];

async function anOrigin(source = 'service_now') {
  return await asTenant(() => createIntegration({ source, intake: 'alert' }));
}

describe('createIntegration', () => {
  it('mints a key that is returned once and never listed on the source', async () => {
    const { secret, integration } = await anOrigin();

    expect(secret.length).toBeGreaterThan(16);
    expect(JSON.stringify(integration)).not.toContain(secret);
    expect(integration.lifecycle).toBe('inactive');
  });

  it('starts without a published mapping', async () => {
    const { integration } = await anOrigin();

    expect(integration.dictionaryStatus).toBe('inactive');
    expect(integration.lifecycle).toBe('inactive');
    expect(integration.mappings).toEqual({});
  });

  it('refuses a name the tenant already uses', async () => {
    await anOrigin();

    await expect(anOrigin()).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('getIntegration', () => {
  it('rejects an unknown source rather than answering an empty integration', async () => {
    await expect(asTenant(() => getIntegration('nao-existe'))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('mappings', () => {
  it('lets several origin values land on the same domain value, never the reverse', async () => {
    await anOrigin();
    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));

    await asTenant(() => upsertMapping('service_now', { field: 'status', from: '1', to: 'open' }));
    await asTenant(() => upsertMapping('service_now', { field: 'status', from: '2', to: 'open' }));
    await asTenant(() =>
      upsertMapping('service_now', { field: 'status', from: '2', to: 'in_progress' }),
    );

    const integration = await asTenant(() => getIntegration('service_now'));
    expect(integration.mappings.status).toHaveLength(2);
    expect(integration.mappings.status?.find(entry => entry.from === '2')?.to).toBe('in_progress');
  });

  it('removes one mapped value', async () => {
    await anOrigin();
    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));
    await asTenant(() => upsertMapping('service_now', { field: 'status', from: '1', to: 'open' }));

    const after = await asTenant(() => removeMapping('service_now', 'status', '1'));

    expect(after.mappings.status ?? []).toHaveLength(0);
  });

  it('refuses to remove a mapping that is already gone', async () => {
    await anOrigin();
    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));

    await expect(
      asTenant(() => removeMapping('service_now', 'status', 'ausente')),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to map values before the fields are published', async () => {
    await anOrigin();

    await expect(
      asTenant(() => upsertMapping('service_now', { field: 'status', from: '1', to: 'open' })),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('bindings', () => {
  it('replaces the whole set, so a path cleared upstream stops being read', async () => {
    await anOrigin();
    await asTenant(() =>
      updateBindings('service_now', [
        ...REQUIRED_ALERT_BINDINGS,
        { field: 'owner', path: 'assignment_group' },
      ]),
    );

    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));

    const integration = await asTenant(() => getIntegration('service_now'));
    expect(integration.bindings.find(row => row.field === 'owner')?.path).toBeNull();
    expect(integration.bindings.find(row => row.field === 'external_id')?.path).toBe('number');
  });

  it('marks the dictionary published — that is what Publicar commits', async () => {
    await anOrigin();
    expect((await asTenant(() => getIntegration('service_now'))).dictionaryStatus).toBe('inactive');

    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));

    expect((await asTenant(() => getIntegration('service_now'))).dictionaryStatus).toBe('active');
  });
});

describe('rollback', () => {
  it('restores the state a change replaced by publishing it again', async () => {
    await asTenant(() =>
      replaceDeadlines([
        { severity: 1, deadlineSeconds: 14400 },
        { severity: 3, deadlineSeconds: 43200 },
      ]),
    );
    await asTenant(() => replaceDeadlines([{ severity: 1, deadlineSeconds: 7200 }]));

    const revisions = await asTenant(() => listRevisions(['deadline']));
    const previous = revisions.find(
      row =>
        Array.isArray(row.payload) &&
        (row.payload as { deadlineSeconds: number }[]).some(item => item.deadlineSeconds === 14400),
    );
    await asTenant(() => rollback(previous?.id ?? 0));

    expect(await asTenant(() => listDeadlines())).toEqual([
      { severity: 1, deadlineSeconds: 14400 },
      { severity: 3, deadlineSeconds: 43200 },
    ]);
  });

  it('marks published documents as revertible, so the screen can preview them', async () => {
    await asTenant(() => replaceDeadlines([{ severity: 1, deadlineSeconds: 14400 }]));

    const [revision] = await asTenant(() => listRevisions(['deadline']));
    expect(revision?.revertible).toBe(true);
    expect(revision?.payload).toEqual([{ severity: 1, deadlineSeconds: 14400 }]);
  });
});

describe('listIntegrations', () => {
  it('returns origin rows without the dictionary, so the list stays cheap', async () => {
    await anOrigin();
    await asTenant(() => updateBindings('service_now', REQUIRED_ALERT_BINDINGS));
    await asTenant(() => upsertMapping('service_now', { field: 'status', from: '1', to: 'open' }));

    const [integration] = await asTenant(() => listIntegrations());

    expect(integration).toEqual({
      source: 'service_now',
      intake: 'alert',
      lifecycle: 'inactive',
    });
  });
});

describe('gateway contract', () => {
  it('lists dictionary fields from GET /rules/schema, including labels', async () => {
    const { integration } = await anOrigin();
    expect(integration.fields.find(field => field.field === 'labels')?.kind).toBe('labels');
    expect(integration.fields.find(field => field.field === 'status')?.domainValues).toContain(
      'open',
    );
    expect(integration.fields.find(field => field.field === 'external_id')?.required).toBe(true);
  });

  it('publishes labels as joined origin fields, not a single path', async () => {
    await anOrigin();
    await asTenant(() =>
      updateBindings('service_now', [
        ...REQUIRED_ALERT_BINDINGS,
        { field: 'labels', path: null, labels: [{ key: 'product', path: 'fields.product' }] },
      ]),
    );

    const integration = await asTenant(() => getIntegration('service_now'));
    expect(integration.bindings.find(row => row.field === 'labels')).toEqual({
      field: 'labels',
      path: null,
      labels: [{ key: 'product', path: 'fields.product' }],
    });
  });

  it('reads KPI targets in the API document shape', async () => {
    await asTenant(() =>
      replaceKpiTargets([{ severities: [1, 2], maxBreaches: 10, achievementPct: 95 }]),
    );
    expect(await asTenant(() => listKpiTargets())).toEqual([
      { severities: [1, 2], maxBreaches: 10, achievementPct: 95 },
    ]);
  });
});
