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

    HMAC_ENABLED: z.stringbool().default(false),
    // Keyed by sources/registry.ts's hmacSecretEnv — one secret per (tenant,
    // source) credential, never one global secret for every origin.
    HMAC_SECRET_LOCAWEB_ITSM: z.string().default(''),
  })
  // Dev runs the loop unsigned; the cluster flips the toggle on with mounted
  // secrets. Turning it on without a secret would silently accept everything
  // signed with the empty string.
  .refine(env => !env.HMAC_ENABLED || env.HMAC_SECRET_LOCAWEB_ITSM.length > 0, {
    path: ['HMAC_SECRET_LOCAWEB_ITSM'],
    message: 'required when HMAC_ENABLED is true',
  });

export type Env = z.infer<typeof envSchema>;

export function rawTopicFor(env: Env, intake: 'alert' | 'monitor'): string {
  return intake === 'alert' ? env.KAFKA_TOPIC_RAW_ALERT : env.KAFKA_TOPIC_RAW_MONITOR;
}
