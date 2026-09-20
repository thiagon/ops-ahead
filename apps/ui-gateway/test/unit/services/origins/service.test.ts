import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretCipher } from '../../../../src/services/origins/cipher.ts';
import { OriginsService } from '../../../../src/services/origins/service.ts';
import { memoryPrisma, TEST_SECRET, TEST_SECRET_KEY } from '../../../helpers/app.ts';

function build(ttlMs = 10_000) {
  const prisma = memoryPrisma();
  return {
    prisma,
    origins: new OriginsService(prisma, new SecretCipher(TEST_SECRET_KEY), ttlMs),
  };
}

describe('OriginsService.find', () => {
  it('decrypts the stored secret for the signature check', async () => {
    const { origins } = build();

    expect(await origins.find('locaweb', 'itsm')).toEqual({
      tenantId: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      secret: TEST_SECRET,
    });
  });

  it('answers nothing for an origin nobody registered', async () => {
    const { origins } = build();

    expect(await origins.find('locaweb', 'datadog')).toBeUndefined();
  });

  it('reuses the lookup within the ttl, so a replay is not a query per event', async () => {
    const { prisma, origins } = build();
    const findUnique = vi.spyOn(prisma.origin, 'findUnique');

    await origins.find('locaweb', 'itsm');
    await origins.find('locaweb', 'itsm');

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('caches a miss too, so an unknown address cannot hammer the database', async () => {
    const { prisma, origins } = build();
    const findUnique = vi.spyOn(prisma.origin, 'findUnique');

    await origins.find('locaweb', 'datadog');
    await origins.find('locaweb', 'datadog');

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again once the entry expires', async () => {
    const { prisma, origins } = build(0);
    const findUnique = vi.spyOn(prisma.origin, 'findUnique');

    await origins.find('locaweb', 'itsm');
    await origins.find('locaweb', 'itsm');

    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe('OriginsService.register', () => {
  it('mints a secret when the caller brings none', async () => {
    const { origins } = build();

    const result = await origins.register('locaweb', 'datadog', 'monitor');

    expect(result.origin).toEqual({ tenant_id: 'locaweb', source: 'datadog', intake: 'monitor' });
    expect(result.secret).toEqual(expect.any(String));
    expect(await origins.find('locaweb', 'datadog')).toMatchObject({ secret: result.secret });
  });

  it('keeps the secret the caller chose', async () => {
    const { origins } = build();

    await origins.register('locaweb', 'datadog', 'alert', 'my-own-secret');

    expect(await origins.find('locaweb', 'datadog')).toMatchObject({ secret: 'my-own-secret' });
  });
});

describe('OriginsService.rotate', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build(0);
  });

  it('replaces the secret and answers with the new one', async () => {
    const result = await ctx.origins.rotate('locaweb', 'itsm');

    expect(result.secret).not.toBe(TEST_SECRET);
    expect(await ctx.origins.find('locaweb', 'itsm')).toMatchObject({ secret: result.secret });
  });

  it('stops accepting the previous secret', async () => {
    await ctx.origins.rotate('locaweb', 'itsm');

    expect(await ctx.origins.find('locaweb', 'itsm')).not.toMatchObject({ secret: TEST_SECRET });
  });

  it('keeps the intake the origin was registered with', async () => {
    const result = await ctx.origins.rotate('locaweb', 'zabbix');

    expect(result.origin.intake).toBe('monitor');
  });

  it('refuses to rotate an origin nobody registered', async () => {
    await expect(ctx.origins.rotate('locaweb', 'datadog')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('OriginsService.list', () => {
  it('never includes a secret', async () => {
    const { origins } = build();

    const listed = await origins.list();

    expect(listed).toContainEqual({ tenant_id: 'locaweb', source: 'itsm', intake: 'alert' });
    for (const origin of listed) expect(origin).not.toHaveProperty('secret');
  });
});
