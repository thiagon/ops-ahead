import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { buildMcpServer } from './server.ts';

/**
 * Stateless mode (`sessionIdGenerator: undefined`): a fresh McpServer +
 * transport per request, no session persisted between calls. Fastify's own
 * response handling is bypassed via reply.hijack(): the transport writes
 * straight to the underlying Node response.
 */
function registerMcpRoutes(app: FastifyInstance): void {
  app.post('/mcp', { schema: { hide: true } }, async (request, reply) => {
    reply.hijack();

    const server = buildMcpServer(app);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}

export default fp(registerMcpRoutes, { name: 'mcp-route', dependencies: ['env', 'services'] });
