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
    // Compacted — the rules data-ingest translates against. Published here,
    // never consumed: the gateway envelopes what arrives without consulting
    // them (services/rules/).
    KAFKA_TOPIC_RULES_MAPPING: z.string().default('rules.mapping'),
    KAFKA_TOPIC_RULES_DEADLINE: z.string().default('rules.deadline'),
    KAFKA_TOPIC_RULES_TARGET: z.string().default('rules.target'),
    KAFKA_TOPIC_ML: z.string().default('trigger.ml'),
    KAFKA_TOPIC_DATA: z.string().default('trigger.data'),

    GATEWAY_DATABASE_URL: z
      .string()
      .default('postgres://admin:ops-ahead-dev@localhost:5432/gateway'),

    HMAC_ENABLED: z.stringbool().default(false),

    /**
     * Decrypts the webhook secrets stored in the origins table
     * (services/origins/cipher.ts). One key for the whole table: registering
     * an origin is an insert, never a write to the Vault.
     */
    ORIGIN_SECRET_KEY: z.string().default(''),
    /**
     * How long a resolved origin is reused before the table is read again.
     * Short enough that a rotation takes effect on its own, long enough that
     * a replay is not one query per event.
     */
    ORIGIN_CACHE_TTL_MS: z.coerce.number().default(10_000),
  })
  .loose();

export type Env = z.infer<typeof envSchema>;

export function rawTopicFor(env: Env, intake: 'alert' | 'monitor'): string {
  return intake === 'alert' ? env.KAFKA_TOPIC_RAW_ALERT : env.KAFKA_TOPIC_RAW_MONITOR;
}
