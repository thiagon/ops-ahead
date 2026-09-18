import { describe, expect, it } from 'vitest';
import { OriginRegistry, parseOriginMessage } from '../../../src/plugins/origin-registry.ts';

function record(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      tenant_id: 'locaweb',
      source: 'service_now',
      intake: 'alert',
      envelope_version: 'v1',
      enabled: true,
      ...overrides,
    }),
  );
}

describe('parseOriginMessage', () => {
  it('names the secret after the origin, so a new one needs no code change', () => {
    expect(parseOriginMessage(record())).toEqual({
      tenantId: 'locaweb',
      source: 'service_now',
      intake: 'alert',
      envelopeVersion: 'v1',
      hmacSecretEnv: 'HMAC_SECRET_LOCAWEB_SERVICE_NOW',
    });
  });

  it('refuses a disabled origin rather than accepting its events', () => {
    expect(parseOriginMessage(record({ enabled: false }))).toBeUndefined();
  });

  it('refuses an intake outside the two the contracts declare', () => {
    expect(parseOriginMessage(record({ intake: 'webhook' }))).toBeUndefined();
  });

  it('survives a malformed record instead of stopping the rehydration', () => {
    expect(parseOriginMessage(Buffer.from('not json'))).toBeUndefined();
    expect(parseOriginMessage(null)).toBeUndefined();
  });
});

describe('OriginRegistry', () => {
  it('keys a credential by tenant and source, never by source alone', () => {
    const registry = new OriginRegistry();
    const credential = parseOriginMessage(record());
    if (!credential) throw new Error('fixture does not parse');

    registry.record(credential);

    expect(registry.find('locaweb', 'service_now')).toBe(credential);
    expect(registry.find('outro', 'service_now')).toBeUndefined();
  });

  it('forgets an origin, so a revoked one stops being accepted', () => {
    const registry = new OriginRegistry();
    const credential = parseOriginMessage(record());
    if (!credential) throw new Error('fixture does not parse');
    registry.record(credential);

    registry.forget('locaweb', 'service_now');

    expect(registry.find('locaweb', 'service_now')).toBeUndefined();
    expect(registry.size).toBe(0);
  });
});
