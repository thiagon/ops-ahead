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
  // Compacted — what each consumer rehydrates its configuration from. The
  // registry that produces them is Postgres, read only by this service.
  KAFKA_TOPIC_CONFIG_ORIGIN: z.string().default('config.origin'),
  KAFKA_TOPIC_CONFIG_DICTIONARY: z.string().default('config.dictionary'),
  KAFKA_TOPIC_CONFIG_DEADLINE: z.string().default('config.deadline'),
  KAFKA_TOPIC_CONFIG_KPI_TARGET: z.string().default('config.kpi-target'),

  CONFIG_DATABASE_URL: z
    .string()
    .default('postgres://config:config@config-postgres.ui.svc.cluster.local:5432/config'),
  CONFIG_DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Where an origin's signing key is written. Reading it back is
  // external-secrets' job — the gateway receives it as an ExternalSecret.
  VAULT_ADDR: z.string().default('http://infra-vault.infra.svc.cluster.local:8200'),
  VAULT_KV_MOUNT: z.string().default('secret'),
  /** One key for every origin secret of this app (1 app = 1 path). */
  VAULT_SECRET_PATH: z.string().default('orchestrator-origins'),
  VAULT_ROLE: z.string().default('ui-orchestrator'),
  VAULT_TOKEN_PATH: z.string().default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
});

export type Env = z.infer<typeof envSchema>;
