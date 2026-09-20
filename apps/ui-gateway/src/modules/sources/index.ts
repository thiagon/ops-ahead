import fp from 'fastify-plugin';
import { registerSourceRoutes } from './routes.ts';

export default fp(registerSourceRoutes, { name: 'sources-route', dependencies: ['services'] });
