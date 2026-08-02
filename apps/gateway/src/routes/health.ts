import type { FastifyInstance } from "fastify";

/** Liveness/readiness. Kept dependency-free so probes never wedge on Kafka. */
export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ status: "ok" }));
}
