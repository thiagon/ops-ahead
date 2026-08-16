import fp from 'fastify-plugin';
import { registerRunRoutes } from './routes.ts';

export default fp(
  async app => {
    registerRunRoutes(app);
  },
  { name: 'runs', dependencies: ['env', 'kafka'] },
);
