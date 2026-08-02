import Fastify, { type FastifyInstance } from "fastify";

import type { Config } from "./config.js";
import { Metrics } from "./metrics.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";

export interface BuildServerOptions {
  config: Config;
  metrics?: Metrics;
}

/** Assemble the Fastify app. Pure wiring — no network side effects on build. */
export function buildServer(opts: BuildServerOptions): FastifyInstance {
  const { config } = opts;
  const metrics = opts.metrics ?? new Metrics();

  const app = Fastify({
    logger: { level: config.logLevel },
    // The gateway must see the exact bytes to verify HMAC, so keep the raw body.
    bodyLimit: 1_048_576,
  });

  registerHealthRoutes(app);
  registerMetricsRoute(app, metrics);

  return app;
}
