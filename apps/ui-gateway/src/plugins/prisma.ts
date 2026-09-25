import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { PrismaClient } from '#generated/prisma/client.ts';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(fastify: FastifyInstance) {
  if (fastify.hasDecorator('prisma')) return;

  const adapter = new PrismaPg({ connectionString: fastify.env.GATEWAY_DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();
  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
}

export default fp(prismaPlugin, { name: 'prisma', dependencies: ['env'] });
