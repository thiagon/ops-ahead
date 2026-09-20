import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../env.ts';

/**
 * One origin the gateway accepts. No bus, no registry to rehydrate: the set
 * comes from ORIGINS, so the gateway answers a request without consulting
 * anything outside its own process.
 */
export interface AcceptedOrigin {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  /** What this origin signs its payloads with. */
  secret: string;
}

export class OriginRegistry {
  #origins = new Map<string, AcceptedOrigin>();

  constructor(origins: Env['ORIGINS']) {
    for (const [key, { intake, secret }] of Object.entries(origins)) {
      const [tenantId, source] = key.split(':');
      // The schema already refused a key shaped otherwise.
      if (tenantId && source) this.#origins.set(key, { tenantId, source, intake, secret });
    }
  }

  find(tenantId: string, source: string): AcceptedOrigin | undefined {
    return this.#origins.get(`${tenantId}:${source}`);
  }

  get size(): number {
    return this.#origins.size;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    origins: OriginRegistry;
  }
}

async function originsPlugin(fastify: FastifyInstance) {
  if (fastify.hasDecorator('origins')) return;

  fastify.decorate('origins', new OriginRegistry(fastify.env.ORIGINS));
}

export default fp(originsPlugin, { name: 'origins', dependencies: ['env'] });
