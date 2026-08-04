import { describe, expect, it } from 'vitest';
import { envSchema } from '../../src/env.ts';

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
      KAFKA_TOPIC: 'incidents.received',
      HMAC_ENABLED: false,
      HMAC_SECRET: '',
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

  it('rejects HMAC_ENABLED without a secret', () => {
    const result = envSchema.safeParse({ HMAC_ENABLED: 'true' });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.HMAC_SECRET).toBeDefined();
  });
});
