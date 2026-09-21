import { z } from 'zod';

const configSchema = z.object({
  SERVICE_NAME: z.string().default('ui-frontend'),
  SERVICE_VERSION: z.string().default('0.1.0'),
  // @clickhouse/client speaks the HTTP interface (port 8123), not the native
  // protocol ml-trainer's clickhouse_driver uses.
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }).default('http://default:@localhost:8123/default'),
  // Where a customer's origin system reaches the gateway from outside the
  // cluster — an ingress host, so it differs per environment and the
  // integration screen has nothing to show until it is set. Screen reads call
  // this host from the browser.
  PUBLIC_GATEWAY_URL: z.url({ protocol: /^https?$/ }).default('https://gateway.ops-ahead.local'),
  // The same gateway reached from inside the cluster. Actions and the
  // ClickHouse JSON routes still hop through here, forwarding the cookie.
  GATEWAY_URL: z.url({ protocol: /^https?$/ }).default('http://gateway.ui.svc.cluster.local'),
  ML_MODEL_SERVING_URL: z
    .url({ protocol: /^https?$/ })
    .default('http://ml-model-serving.ml.svc.cluster.local:3000'),
  // The queue renders on consumed_ratio alone when serving is slow — the
  // budget bounds the whole page, not one prediction.
  ML_MODEL_SERVING_TIMEOUT_MS: z.coerce.number().int().positive().default(1500),
});

export type Config = z.infer<typeof configSchema>;

export function parseConfig(env: NodeJS.ProcessEnv | Record<string, unknown>): Config {
  return configSchema.parse(env);
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}
