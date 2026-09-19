import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.string().default('development'),
    APP_ENV: z.string().default('dev'),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.string().default('info'),
    SERVICE_NAME: z.string().default('gateway'),
    SERVICE_VERSION: z.string().default('0.1.0'),

    // Whether TLS terminates in front of the gateway.
    HTTPS_ENABLED: z.stringbool().default(false),

    // Empty reflects whatever origin asks.
    CORS_ORIGINS: z
      .string()
      .default('[]')
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'must be a JSON array of origins' });
          return z.NEVER;
        }
      })
      .pipe(z.array(z.url())),

    KAFKA_BOOTSTRAP_SERVERS: z.string().default('localhost:9092'),
    // One raw topic per intake nature — never a single stream for both
    // (domain/ubiquitous-language.md#intake).
    KAFKA_TOPIC_RAW_ALERT: z.string().default('events.raw.alert'),
    KAFKA_TOPIC_RAW_MONITOR: z.string().default('events.raw.monitor'),
    // Compacted — which origins the gateway accepts, rehydrated at boot
    // (plugins/origin-registry.ts).
    KAFKA_TOPIC_CONFIG_ORIGIN: z.string().default('config.origin'),
    KAFKA_TOPIC_ML: z.string().default('trigger.ml'),
    KAFKA_TOPIC_DATA: z.string().default('trigger.data'),
    KAFKA_TOPIC_STATUS: z.string().default('trigger.status'),

    GATEWAY_DATABASE_URL: z
      .string()
      .default('postgres://admin:ops-ahead-dev@localhost:5432/gateway'),

    HMAC_ENABLED: z.stringbool().default(false),
  })
  // Each origin's secret arrives as HMAC_SECRET_<TENANT>_<SOURCE>, named after
  // the origin the registry resolved, so the set is not known at parse time —
  // a signed request against a missing secret fails the check rather than
  // passing unverified.
  .loose();

export type Env = z.infer<typeof envSchema>;

export function rawTopicFor(env: Env, intake: 'alert' | 'monitor'): string {
  return intake === 'alert' ? env.KAFKA_TOPIC_RAW_ALERT : env.KAFKA_TOPIC_RAW_MONITOR;
}
