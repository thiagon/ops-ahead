import fp from 'fastify-plugin';
import { registerOriginRoutes } from './routes.ts';

export default fp(registerOriginRoutes, { name: 'origins-route', dependencies: ['services'] });
