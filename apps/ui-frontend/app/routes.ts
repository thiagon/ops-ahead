import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('health', 'routes/health.ts'),
  route('metrics', 'routes/metrics.ts'),
  route('data/:tenant/open-count', 'routes/data/open-count.ts'),
  route('data/:tenant/integrations/:source/flash', 'routes/data/secret-flash.ts'),
  route('data/:tenant/panel', 'routes/data/panel.ts'),
  route('data/:tenant/manager', 'routes/data/manager.ts'),
  route('data/:tenant/queue', 'routes/data/queue.ts'),
  route('data/:tenant/occurrences/:source/:externalId', 'routes/data/occurrence.ts'),
  route('data/:tenant/occurrences/:source/:externalId/detail', 'routes/data/occurrence-detail.ts'),
  route(':tenant', 'routes/tenant.tsx', [
    index('routes/panel.tsx'),
    route('manager', 'routes/manager.tsx'),
    route('analyses', 'routes/analyses.tsx'),
    route('queue', 'routes/queue.tsx'),
    route('integrations', 'routes/integrations.tsx'),
    route('integrations/:source', 'routes/integration-detail.tsx'),
    route('targets', 'routes/targets.tsx'),
    route('deadlines', 'routes/deadlines.tsx'),
    // Paths this app shipped with, kept so old links resolve.
    route('metas', 'routes/targets-legacy.tsx'),
    route('prazos', 'routes/deadlines-legacy.tsx'),
    route('trainings', 'routes/trainings-legacy.tsx'),
    route('occurrences/:source/:externalId', 'routes/occurrence.tsx'),
    route('occurrences/:source/:externalId/detail', 'routes/occurrence-detail.ts'),
  ]),
] satisfies RouteConfig;
