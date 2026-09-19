import { Counter, collectDefaultMetrics, Registry } from 'prom-client';

/**
 * A registry of this app's own instead of the prom-client global one — same
 * shape as apps/ui-gateway, so /metrics exposes exactly what this app declares.
 */
function createRegistry() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const goldQueries = new Counter({
    name: 'frontend_gold_queries_total',
    help: 'Queries the server-side loaders issued against the ClickHouse gold layer',
    labelNames: ['table', 'outcome'],
    registers: [registry],
  });

  return { registry, goldQueries };
}

export const metrics = createRegistry();
