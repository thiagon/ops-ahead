import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  APP_ENV: z.string().default('dev'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  SERVICE_NAME: z.string().default('orchestrator'),
  SERVICE_VERSION: z.string().default('0.1.0'),

  KAFKA_BOOTSTRAP_SERVERS: z.string().default('localhost:9092'),
  KAFKA_TOPIC_ML: z.string().default('trigger.ml'),
  KAFKA_TOPIC_DATA: z.string().default('trigger.data'),
  // Compacted — the source of truth GET /runs/{run_id} is rehydrated from.
  KAFKA_TOPIC_STATUS: z.string().default('trigger.status'),
});

export type Env = z.infer<typeof envSchema>;
