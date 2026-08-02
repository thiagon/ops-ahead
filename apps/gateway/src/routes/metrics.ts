import type { FastifyInstance } from "fastify";

import type { Metrics } from "../metrics.js";

/** Prometheus scrape endpoint backed by the app's isolated registry. */
export function registerMetricsRoute(app: FastifyInstance, metrics: Metrics): void {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
}
