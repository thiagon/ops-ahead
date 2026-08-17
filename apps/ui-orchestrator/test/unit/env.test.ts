import { describe, expect, it } from 'vitest';
import { envSchema } from '../../src/env.ts';

describe('envSchema', () => {
  it('applies defaults suited to local dev', () => {
    const env = envSchema.parse({});

    expect(env.PORT).toBe(3000);
    expect(env.SERVICE_NAME).toBe('orchestrator');
    expect(env.KAFKA_TOPIC_ML).toBe('trigger.ml');
    expect(env.KAFKA_TOPIC_DATA).toBe('trigger.data');
    expect(env.KAFKA_TOPIC_STATUS).toBe('trigger.status');
  });

  it('coerces PORT from a string, as env vars always are', () => {
    const env = envSchema.parse({ PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });
});
