import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretCipher } from '../../../../src/lib/cipher.ts';
import { SourcesService } from '../../../../src/services/sources/service.ts';
import { memoryPrisma, TEST_SECRET, TEST_SECRET_KEY } from '../../../helpers/app.ts';

function build(ttlMs = 10_000) {
  const prisma = memoryPrisma();
  return {
    prisma,
    sources: new SourcesService(prisma, new SecretCipher(TEST_SECRET_KEY), ttlMs),
  };
}

describe('SourcesService.find', () => {
  it('decrypts the stored secret for the signature check', async () => {
    const { sources } = build();

    expect(await sources.find('locaweb', 'itsm')).toEqual({
      tenantId: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
      secret: TEST_SECRET,
    });
  });

  it('answers nothing for a source nobody registered', async () => {
    const { sources } = build();

    expect(await sources.find('locaweb', 'datadog')).toBeUndefined();
  });

  it('answers nothing for a source registered under another tenant', async () => {
    const { sources } = build();

    expect(await sources.find('outro-tenant', 'itsm')).toBeUndefined();
  });

  it('reuses the lookup within the ttl, so a replay is not a query per event', async () => {
    const { prisma, sources } = build();
    const findUnique = vi.spyOn(prisma.source, 'findUnique');

    await sources.find('locaweb', 'itsm');
    await sources.find('locaweb', 'itsm');

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches a miss too, so an unknown address cannot hammer the database', async () => {
    const { prisma, sources } = build();
    const findUnique = vi.spyOn(prisma.source, 'findUnique');

    await sources.find('locaweb', 'datadog');
    await sources.find('locaweb', 'datadog');

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again once the entry expires', async () => {
    const { prisma, sources } = build(0);
    const findUnique = vi.spyOn(prisma.source, 'findUnique');

    await sources.find('locaweb', 'itsm');
    await sources.find('locaweb', 'itsm');

    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('SourcesService.register', () => {
  it('mints a secret when the caller brings none', async () => {
    const { sources } = build();

    const result = await sources.register('locaweb', 'datadog', 'monitor');

    expect(result.source).toEqual({
      tenant_id: 'locaweb',
      source: 'datadog',
      intake: 'monitor',
      status: 'active',
    });
    expect(result.secret).toEqual(expect.any(String));
    expect(await sources.find('locaweb', 'datadog')).toMatchObject({ secret: result.secret });
  });

  it('keeps the secret the caller chose', async () => {
    const { sources } = build();

    await sources.register('locaweb', 'datadog', 'alert', 'my-own-secret');

    expect(await sources.find('locaweb', 'datadog')).toMatchObject({ secret: 'my-own-secret' });
  });

  it('keeps two tenants using the same source name apart', async () => {
    const { sources } = build();

    await sources.register('outro-tenant', 'itsm', 'alert', 'another-tenants-secret');

    expect(await sources.find('locaweb', 'itsm')).toMatchObject({ secret: TEST_SECRET });
    expect(await sources.find('outro-tenant', 'itsm')).toMatchObject({
      secret: 'another-tenants-secret',
    });
  });
});

describe('SourcesService.rotate', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build(0);
  });

  it('replaces the secret and answers with the new one', async () => {
    const result = await ctx.sources.rotate('locaweb', 'itsm');

    expect(result.secret).not.toBe(TEST_SECRET);
    expect(await ctx.sources.find('locaweb', 'itsm')).toMatchObject({ secret: result.secret });
  });

  it('stops accepting the previous secret', async () => {
    await ctx.sources.rotate('locaweb', 'itsm');

    expect(await ctx.sources.find('locaweb', 'itsm')).not.toMatchObject({ secret: TEST_SECRET });
  });

  it('keeps the intake the source was registered with', async () => {
    const result = await ctx.sources.rotate('locaweb', 'zabbix');

    expect(result.source.intake).toBe('monitor');
  });

  it('refuses to rotate a source nobody registered', async () => {
    await expect(ctx.sources.rotate('locaweb', 'datadog')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("refuses to rotate another tenant's source", async () => {
    await expect(ctx.sources.rotate('outro-tenant', 'itsm')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('SourcesService.listByTenant', () => {
  it('never includes a secret', async () => {
    const { sources } = build();

    const listed = await sources.listByTenant('locaweb');

    expect(listed).toContainEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
    });
    for (const source of listed) expect(source).not.toHaveProperty('secret');
  });

  it("leaves out another tenant's sources", async () => {
    const { sources } = build();
    await sources.register('outro-tenant', 'datadog', 'monitor');

    const listed = await sources.listByTenant('locaweb');

    expect(listed.every(source => source.tenant_id === 'locaweb')).toBe(true);
  });
});

describe('SourcesService.setStatus', () => {
  it('disables a source without losing its secret', async () => {
    const { sources } = build(0);

    const disabled = await sources.setStatus('locaweb', 'itsm', 'disabled');

    expect(disabled.status).toBe('disabled');
    // Still resolvable, so a webhook can tell "turned off" from "never existed".
    expect(await sources.find('locaweb', 'itsm')).toMatchObject({
      status: 'disabled',
      secret: TEST_SECRET,
    });
  });

  it('enables a source back with the secret it already had', async () => {
    const { sources } = build(0);
    await sources.setStatus('locaweb', 'itsm', 'disabled');

    await sources.setStatus('locaweb', 'itsm', 'active');

    expect(await sources.find('locaweb', 'itsm')).toMatchObject({
      status: 'active',
      secret: TEST_SECRET,
    });
  });

  it('keeps a disabled source disabled when it is registered again', async () => {
    const { sources } = build(0);
    await sources.setStatus('locaweb', 'itsm', 'disabled');

    const result = await sources.register('locaweb', 'itsm', 'alert');

    expect(result.source.status).toBe('disabled');
  });

  it('refuses to change a source nobody registered', async () => {
    const { sources } = build();

    await expect(sources.setStatus('locaweb', 'datadog', 'disabled')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('shows the status in the listing', async () => {
    const { sources } = build(0);
    await sources.setStatus('locaweb', 'zabbix', 'disabled');

    const listed = await sources.listByTenant('locaweb');

    expect(listed).toContainEqual({
      tenant_id: 'locaweb',
      source: 'zabbix',
      intake: 'monitor',
      status: 'disabled',
    });
  });
});
