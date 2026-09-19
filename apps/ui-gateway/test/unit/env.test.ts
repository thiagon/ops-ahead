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
      KAFKA_TOPIC_CONFIG_ORIGIN: 'config.origin',
      KAFKA_TOPIC_ML: 'trigger.ml',
      KAFKA_TOPIC_DATA: 'trigger.data',
      GATEWAY_DATABASE_URL: 'postgres://admin:ops-ahead-dev@localhost:5432/gateway',
      HMAC_ENABLED: false,
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

  it("carries each origin's own secret, named after the origin", () => {
    const result = envSchema.safeParse({
      HMAC_ENABLED: 'true',
      HMAC_SECRET_LOCAWEB_ITSM: 'sekret',
    });

    // Which origins exist comes from configuration, so the set of secrets is
    // not known at parse time and each is read by the name the registry
    // resolved (plugins/origin-registry.ts).
    expect(result.success).toBe(true);
    expect((result.data as unknown as Record<string, string>).HMAC_SECRET_LOCAWEB_ITSM).toBe(
      'sekret',
    );
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
