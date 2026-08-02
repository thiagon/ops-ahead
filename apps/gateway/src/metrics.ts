import { Counter, Registry, collectDefaultMetrics } from "prom-client";

/**
 * A self-contained metrics registry so tests can build isolated instances
 * without tripping prom-client's "metric already registered" global guard.
 */
export class Metrics {
  readonly registry: Registry;
  readonly eventsPublished: Counter<"source">;
  readonly hmacFailures: Counter<string>;
  readonly kafkaFailures: Counter<string>;
  readonly validationFailures: Counter<"source">;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.eventsPublished = new Counter({
      name: "gateway_events_published_total",
      help: "Events normalized and published to incidents.raw",
      labelNames: ["source"],
      registers: [this.registry],
    });

    this.hmacFailures = new Counter({
      name: "gateway_hmac_failures_total",
      help: "Requests rejected for invalid or missing HMAC signature",
      registers: [this.registry],
    });

    this.kafkaFailures = new Counter({
      name: "gateway_kafka_failures_total",
      help: "Publish attempts that failed because Kafka was unavailable",
      registers: [this.registry],
    });

    this.validationFailures = new Counter({
      name: "gateway_validation_failures_total",
      help: "Webhook payloads rejected by schema validation",
      labelNames: ["source"],
      registers: [this.registry],
    });
  }
}
