import fp from 'fastify-plugin';
import { registerAuthRoutes } from './routes.ts';

export default fp(registerAuthRoutes, {
  name: 'auth-routes',
  dependencies: ['env', 'services', 'auth'],
});
