import fp from 'fastify-plugin';
import { registerIncidentRoutes } from './routes.ts';

export default fp(registerIncidentRoutes, {
  name: 'incidents-route',
  dependencies: ['env', 'hmac', 'kafka', 'metrics'],
});
