import { z } from "zod";

/**
 * Typed configuration loaded from the environment. Defaults target local dev;
 * the Helm overlay injects cluster values. HMAC is opt-in — dev runs the loop
 * without signatures, the cluster flips HMAC_ENABLED on with a mounted secret.
 */
const ConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().int().positive().default(8080),
  logLevel: z.string().default("info"),

  kafkaBrokers: z.string().default("localhost:9092"),
  kafkaTopic: z.string().default("incidents.raw"),
  kafkaClientId: z.string().default("ops-ahead-gateway"),

  hmacEnabled: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  hmacSecret: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = ConfigSchema.parse({
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    kafkaBrokers: env.KAFKA_BOOTSTRAP_SERVERS,
    kafkaTopic: env.KAFKA_TOPIC,
    kafkaClientId: env.KAFKA_CLIENT_ID,
    hmacEnabled: env.HMAC_ENABLED,
    hmacSecret: env.HMAC_SECRET,
  });

  if (config.hmacEnabled && !config.hmacSecret) {
    throw new Error("HMAC_ENABLED=true but HMAC_SECRET is empty");
  }

  return config;
}
