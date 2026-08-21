import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/dashboard.tsx'),
  route('fila', 'routes/queue.tsx'),
  route('ocorrencias/:source/:externalId', 'routes/occurrence.tsx'),
  route('health', 'routes/health.ts'),
  route('metrics', 'routes/metrics.ts'),
] satisfies RouteConfig;
