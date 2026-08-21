import { index, type RouteConfig, route } from '@react-router/dev/routes';

export default [
  index('routes/painel.tsx'),
  route('painel-gestor', 'routes/gestor.tsx'),
  route('fila', 'routes/queue.tsx'),
  route('ocorrencias/:source/:externalId', 'routes/occurrence.tsx'),
  route('ocorrencias/:source/:externalId/detalhe', 'routes/occurrence-detail.ts'),
  route('health', 'routes/health.ts'),
  route('metrics', 'routes/metrics.ts'),
] satisfies RouteConfig;
