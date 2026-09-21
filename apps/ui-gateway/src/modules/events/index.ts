import fp from 'fastify-plugin';
import { registerEventRoutes } from './routes.ts';

export default fp(registerEventRoutes, {
  name: 'events-route',
  dependencies: ['hmac', 'metrics', 'services', 'auth'],
});
