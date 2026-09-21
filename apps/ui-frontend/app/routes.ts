import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/home.tsx'),
  route('health', 'routes/health.ts'),
  route('metrics', 'routes/metrics.ts'),
  route(':tenant', 'routes/tenant.tsx', [
    index('routes/panel.tsx'),
    route('manager', 'routes/manager.tsx'),
    route('queue', 'routes/queue.tsx'),
    route('integrations', 'routes/integrations.tsx'),
    route('integrations/:source', 'routes/integration-detail.tsx'),
    route('targets', 'routes/targets.tsx'),
    route('deadlines', 'routes/deadlines.tsx'),
    // The Portuguese paths this app shipped with, kept so old links resolve.
    route('metas', 'routes/targets-legacy.tsx'),
    route('prazos', 'routes/deadlines-legacy.tsx'),
    route('occurrences/:source/:externalId', 'routes/occurrence.tsx'),
    route('occurrences/:source/:externalId/detail', 'routes/occurrence-detail.ts'),
  ]),
] satisfies RouteConfig;
