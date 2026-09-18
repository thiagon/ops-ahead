import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import postgres, { type Sql } from 'postgres';

declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
  }
}

async function postgresPlugin(fastify: FastifyInstance) {
  // A test hands in its own Sql; only the missing half gets real wiring.
  if (fastify.hasDecorator('sql')) return;

  const sql = postgres(fastify.env.CONFIG_DATABASE_URL, {
    max: fastify.env.CONFIG_DATABASE_POOL_MAX,
    // Fastify's own logger already carries request context; the driver's
    // notices would arrive outside it.
    onnotice: notice => fastify.log.debug({ notice }, 'postgres notice'),
  });

  fastify.decorate('sql', sql);

  fastify.addHook('onClose', async () => {
    await sql.end();
  });
}

export default fp(postgresPlugin, { name: 'postgres', dependencies: ['env'] });
