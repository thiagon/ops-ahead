import fp from 'fastify-plugin';
import { registerRulesRoutes } from './routes.ts';

export default fp(registerRulesRoutes, {
  name: 'rules-route',
  dependencies: ['services', 'auth'],
});
