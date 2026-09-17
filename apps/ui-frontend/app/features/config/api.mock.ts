import catalog from './fixtures.json';
import type { ConfigCatalog, Dictionary, FieldMap, Origin } from './types.ts';

/**
 * Stands in for the configuration API until ui-orchestrator exposes it. It
 * answers a Request with a Response over the same routes and status codes the
 * real service will, so config.service.ts is written against the final contract
 * and only its transport changes later.
 */

const ROUTES = {
  integrations: /^\/tenants\/([^/]+)\/integrations$/,
  integration: /^\/tenants\/([^/]+)\/integrations\/([^/]+)$/,
  deadlines: /^\/tenants\/([^/]+)\/deadlines$/,
  kpiTargets: /^\/tenants\/([^/]+)\/kpi-targets$/,
  revisions: /^\/tenants\/([^/]+)\/revisions$/,
};

const data = catalog as ConfigCatalog;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function notFound(detail: string): Response {
  return json({ detail }, 404);
}

/** The integration as the API returns it: the origin plus what it maps. */
function composeIntegration(
  origin: Origin,
  fieldMap: FieldMap | undefined,
  dictionary: Dictionary | undefined,
) {
  return {
    source: origin.source,
    intake: origin.intake,
    envelopeVersion: origin.envelopeVersion,
    secretCreatedAt: origin.secretCreatedAt,
    enabled: origin.enabled,
    dictionaryVersion: dictionary?.version ?? null,
    dictionaryStatus: dictionary?.status ?? null,
    bindings: fieldMap?.bindings ?? [],
    mappings: dictionary?.mappings ?? {},
  };
}

export async function handleConfigRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);

  const integrations = pathname.match(ROUTES.integrations);
  if (integrations) {
    const [, tenantId] = integrations;
    return json({
      items: data.origins
        .filter(origin => origin.tenantId === tenantId)
        .map(origin =>
          composeIntegration(
            origin,
            data.fieldMaps.find(m => m.tenantId === tenantId && m.source === origin.source),
            data.dictionaries.find(d => d.tenantId === tenantId && d.source === origin.source),
          ),
        ),
    });
  }

  const integration = pathname.match(ROUTES.integration);
  if (integration) {
    const [, tenantId, source] = integration;
    const origin = data.origins.find(
      entry => entry.tenantId === tenantId && entry.source === source,
    );
    if (!origin) return notFound(`integration ${source} not found`);

    return json(
      composeIntegration(
        origin,
        data.fieldMaps.find(m => m.tenantId === tenantId && m.source === source),
        data.dictionaries.find(d => d.tenantId === tenantId && d.source === source),
      ),
    );
  }

  const deadlines = pathname.match(ROUTES.deadlines);
  if (deadlines) {
    const [, tenantId] = deadlines;
    return json({
      items: data.deadlines
        .filter(entry => entry.tenantId === tenantId)
        .map(({ severity, deadlineSeconds }) => ({ severity, deadlineSeconds })),
    });
  }

  const kpiTargets = pathname.match(ROUTES.kpiTargets);
  if (kpiTargets) {
    const [, tenantId] = kpiTargets;
    return json({
      items: data.kpiTargets
        .filter(entry => entry.tenantId === tenantId)
        .map(({ kpiGroup, maxBreaches, achievementPct }) => ({
          kpiGroup,
          maxBreaches,
          achievementPct,
        })),
    });
  }

  const revisions = pathname.match(ROUTES.revisions);
  if (revisions) {
    const [, tenantId] = revisions;
    return json({
      items: data.revisions
        .filter(entry => entry.tenantId === tenantId)
        .map(({ id, domain, summary, author, at }) => ({ id, domain, summary, author, at })),
    });
  }

  return notFound(`no route for ${pathname}`);
}
