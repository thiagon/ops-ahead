import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  createIntegration,
  getIntegration,
  listDeadlines,
  listIntegrations,
  listRevisions,
  NotFoundError,
  removeMapping,
  replaceDeadlines,
  rollback,
  updateBindings,
  upsertMapping,
} from '../app/features/config/repo.server.ts';

/**
 * Runs against a real Postgres — the registry's behaviour is in its keys,
 * transactions and cascades, which a stub would not reproduce.
 */
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

beforeEach(async () => {
  await prisma.revision.deleteMany();
  await prisma.origin.deleteMany();
  await prisma.deadline.deleteMany();
  await prisma.kpiTarget.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function anOrigin(source = 'service_now') {
  return await createIntegration({ source, intake: 'monitor', envelopeVersion: 'v1' });
}

describe('createIntegration', () => {
  it('mints a key that is returned once and never stored', async () => {
    const { secret } = await anOrigin();

    expect(secret).toHaveLength(43);
    const stored = await prisma.origin.findFirst({ where: { source: 'service_now' } });
    // Only when it was minted — the key itself is nowhere in the row.
    expect(stored?.secretCreatedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it('starts the dictionary as a draft, since nothing is mapped yet', async () => {
    const { integration } = await anOrigin();

    expect(integration.dictionaryStatus).toBe('draft');
    expect(integration.mappings).toEqual({});
  });

  it('refuses a name the tenant already uses', async () => {
    await anOrigin();

    await expect(anOrigin()).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('getIntegration', () => {
  it('rejects an unknown source rather than answering an empty integration', async () => {
    await expect(getIntegration('nao-existe')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('mappings', () => {
  it('lets several origin values land on the same domain value, never the reverse', async () => {
    await anOrigin();

    await upsertMapping('service_now', { field: 'condition', from: 'PROBLEM', to: 'firing' });
    await upsertMapping('service_now', { field: 'condition', from: 'ALERTA', to: 'firing' });
    // Same origin value again: the target is corrected, not duplicated.
    await upsertMapping('service_now', { field: 'condition', from: 'ALERTA', to: 'cleared' });

    const integration = await getIntegration('service_now');
    expect(integration.mappings.condition).toHaveLength(2);
    expect(integration.mappings.condition?.find(e => e.from === 'ALERTA')?.to).toBe('cleared');
  });

  it('removes one mapped value and records what it was', async () => {
    await anOrigin();
    await upsertMapping('service_now', { field: 'condition', from: 'PROBLEM', to: 'firing' });
    const [entry] = (await getIntegration('service_now')).mappings.condition ?? [];

    const after = await removeMapping('service_now', entry?.id ?? '');

    expect(after.mappings.condition ?? []).toHaveLength(0);
    expect((await listRevisions())[0]?.summary).toBe('PROBLEM removido de condition');
  });

  it('refuses to remove a mapping that is already gone', async () => {
    await anOrigin();

    await expect(removeMapping('service_now', crypto.randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('bindings', () => {
  it('replaces the whole set, so a path cleared upstream stops being read', async () => {
    await anOrigin();
    await updateBindings('service_now', [
      { field: 'external_id', path: 'event.id' },
      { field: 'title', path: 'event.name' },
    ]);

    await updateBindings('service_now', [{ field: 'external_id', path: 'event.id' }]);

    const integration = await getIntegration('service_now');
    expect(integration.bindings).toEqual([{ field: 'external_id', path: 'event.id' }]);
  });

  it('marks the dictionary published — that is what Publicar commits', async () => {
    await anOrigin();
    expect((await getIntegration('service_now')).dictionaryStatus).toBe('draft');

    await updateBindings('service_now', [{ field: 'external_id', path: 'event.id' }]);

    expect((await getIntegration('service_now')).dictionaryStatus).toBe('published');
  });
});

describe('rollback', () => {
  it('restores the state a change replaced, and is itself revertible', async () => {
    await replaceDeadlines([
      { severity: 1, deadlineSeconds: 14400 },
      { severity: 3, deadlineSeconds: 43200 },
    ]);
    await replaceDeadlines([{ severity: 1, deadlineSeconds: 7200 }]);

    const [latest] = await listRevisions();
    await rollback(latest?.id ?? '');

    expect(await listDeadlines()).toEqual([
      { severity: 1, deadlineSeconds: 14400 },
      { severity: 3, deadlineSeconds: 43200 },
    ]);
  });

  it('marks which revisions can be reverted, so the screen offers only those', async () => {
    await anOrigin();
    await replaceDeadlines([{ severity: 1, deadlineSeconds: 14400 }]);

    const bySummary = new Map((await listRevisions()).map(r => [r.summary, r.revertible]));

    // Replacing the deadlines left a prior state; creating an origin did not.
    expect(bySummary.get('Prazos atualizados')).toBe(true);
    expect(bySummary.get('Integração service_now criada')).toBe(false);
  });

  it('refuses a change that recorded no prior state', async () => {
    await anOrigin();
    // Creating an integration replaced nothing, so there is nothing to restore.
    const [creation] = await listRevisions();

    await expect(rollback(creation?.id ?? '')).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('listIntegrations', () => {
  it('embeds bindings and mappings, so one integration is one read', async () => {
    await anOrigin();
    await updateBindings('service_now', [{ field: 'external_id', path: 'event.id' }]);
    await upsertMapping('service_now', { field: 'condition', from: 'PROBLEM', to: 'firing' });

    const [integration] = await listIntegrations();

    expect(integration?.bindings).toHaveLength(1);
    expect(integration?.mappings.condition).toHaveLength(1);
  });
});
