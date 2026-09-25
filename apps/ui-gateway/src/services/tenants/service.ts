import type { PrismaClient } from '#generated/prisma/client.ts';

/**
 * The Authentik group is what says a tenant exists and who may act for it
 * (spec-gateway-auth-v2). This table only exists so sources, mappings,
 * deadlines and targets have something to reference, so a row is materialized
 * from the claim rather than authored — there is no second place to register
 * a client.
 */
export class TenantsService {
  #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async ensure(tenantId: string): Promise<void> {
    await this.#prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId },
      update: {},
    });
  }
}
