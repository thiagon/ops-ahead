import { z } from 'zod';

const configSchema = z.object({
  SERVICE_NAME: z.string().default('ui-frontend'),
  SERVICE_VERSION: z.string().default('0.1.0'),
  // @clickhouse/client speaks the HTTP interface (port 8123), not the native
  // protocol ml-trainer's clickhouse_driver uses.
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }).default('http://default:@localhost:8123/default'),
  TENANT_ID: z.string().min(1).default('locaweb'),
  // Where a customer's origin system reaches the gateway from outside the
  // cluster — an ingress host, so it differs per environment and the
  // integration screen has nothing to show until it is set.
  PUBLIC_GATEWAY_URL: z.url({ protocol: /^https?$/ }).default('https://gateway.ops-ahead.local'),
  // The configuration registry this app owns — nothing else reads or writes
  // it (apps/ui-frontend/prisma/schema.prisma).
  CONFIG_DATABASE_URL: z
    .string()
    .min(1)
    .default('postgres://config:config@config-postgres.ui.svc.cluster.local:5432/config'),
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
