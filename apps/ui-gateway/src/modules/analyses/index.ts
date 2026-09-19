import fp from 'fastify-plugin';
import { registerAnalysisRoutes } from './routes.ts';

export default fp(registerAnalysisRoutes, { name: 'analyses-route', dependencies: ['services'] });
