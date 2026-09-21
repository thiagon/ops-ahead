import { describe, expect, it } from 'vitest';
import { envSchema, rawTopicFor } from '../../src/env.ts';

describe('envSchema', () => {
  it('applies defaults when nothing is set', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      APP_ENV: 'dev',
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      SERVICE_NAME: 'gateway',
      SERVICE_VERSION: '0.1.0',
      HTTPS_ENABLED: false,
      CORS_ORIGINS: [],
      KAFKA_BOOTSTRAP_SERVERS: 'localhost:9092',
      KAFKA_TOPIC_RAW_ALERT: 'events.raw.alert',
      KAFKA_TOPIC_RAW_MONITOR: 'events.raw.monitor',
      KAFKA_TOPIC_RULES_MAPPING: 'rules.mapping',
      KAFKA_TOPIC_RULES_DEADLINE: 'rules.deadline',
      KAFKA_TOPIC_RULES_TARGET: 'rules.target',
      KAFKA_TOPIC_ML: 'trigger.ml',
      KAFKA_TOPIC_DATA: 'trigger.data',
      GATEWAY_DATABASE_URL: 'postgres://admin:ops-ahead-dev@localhost:5432/gateway',
      HMAC_ENABLED: false,
      SOURCE_SECRET_KEY: '',
      SESSION_COOKIE_KEY: '',
      SCHEDULER_API_KEY: '',
      AUTHENTIK_ISSUER: '',
      AUTHENTIK_CLIENT_ID: '',
      AUTHENTIK_CLIENT_SECRET: '',
      AUTHENTIK_MCP_CLIENT_ID: '',
      INTROSPECTION_CACHE_TTL_MS: 5_000,
      FRONTEND_ORIGIN: 'http://localhost:5173',
      PUBLIC_URL: 'http://localhost:3000',
      SOURCE_CACHE_TTL_MS: 10_000,
    });
  });

  it('coerces PORT to a number', () => {
    expect(envSchema.parse({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails when PORT is not numeric', () => {
    const result = envSchema.safeParse({ PORT: 'not-a-port' });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.PORT).toBeDefined();
  });

  it('reads CORS_ORIGINS as a JSON array', () => {
    const origins = ['http://ui.ops-ahead.localtest.me', 'https://ops-ahead.example.com'];

    expect(envSchema.parse({ CORS_ORIGINS: JSON.stringify(origins) }).CORS_ORIGINS).toEqual(
      origins,
    );
  });

  it('rejects CORS_ORIGINS that is not a list of urls', () => {
    const result = envSchema.safeParse({ CORS_ORIGINS: 'http://ui.ops-ahead.localtest.me' });

    expect(result.success).toBe(false);
  });

  it('coerces the source cache ttl to a number', () => {
    expect(envSchema.parse({ SOURCE_CACHE_TTL_MS: '500' }).SOURCE_CACHE_TTL_MS).toBe(500);
  });
});

describe('rawTopicFor', () => {
  const env = envSchema.parse({});

  it('picks the alert raw topic for the alert intake', () => {
    expect(rawTopicFor(env, 'alert')).toBe('events.raw.alert');
  });

  it('picks the monitor raw topic for the monitor intake', () => {
    expect(rawTopicFor(env, 'monitor')).toBe('events.raw.monitor');
  });
});
