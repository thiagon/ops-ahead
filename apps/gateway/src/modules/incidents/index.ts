import fp from 'fastify-plugin';
import { registerIncidentRoutes } from './routes.ts';

export default fp(
  async app => {
    registerIncidentRoutes(app);
  },
  { name: 'incidents', dependencies: ['env'] },
);
