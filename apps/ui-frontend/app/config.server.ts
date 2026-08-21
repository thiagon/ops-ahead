import { z } from 'zod';

const configSchema = z.object({
  SERVICE_NAME: z.string().default('ui-frontend'),
  SERVICE_VERSION: z.string().default('0.1.0'),
  // @clickhouse/client speaks the HTTP interface (port 8123), not the native
  // protocol ml-trainer's clickhouse_driver uses.
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }).default('http://default:@localhost:8123/default'),
  TENANT_ID: z.string().min(1).default('locaweb'),
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
