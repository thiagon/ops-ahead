import fp from 'fastify-plugin';
import { registerTriggerRoutes } from './routes.ts';

export default fp(
  async app => {
    registerTriggerRoutes(app);
  },
  { name: 'trigger', dependencies: ['env', 'kafka'] },
);
