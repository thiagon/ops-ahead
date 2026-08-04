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

    KAFKA_BOOTSTRAP_SERVERS: z.string().default('localhost:9092'),
    KAFKA_TOPIC: z.string().default('incidents.received'),

    HMAC_ENABLED: z.stringbool().default(false),
    HMAC_SECRET: z.string().default(''),
  })
  // Dev runs the loop unsigned; the cluster flips the toggle on with a mounted
  // secret. Turning it on without a secret would silently accept everything.
  .refine(env => !env.HMAC_ENABLED || env.HMAC_SECRET.length > 0, {
    path: ['HMAC_SECRET'],
    message: 'HMAC_SECRET is required when HMAC_ENABLED is true',
  });

export type Env = z.infer<typeof envSchema>;
