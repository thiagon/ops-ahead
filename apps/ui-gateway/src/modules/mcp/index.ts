import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { tenantParamsSchema } from './schema.ts';
import { buildMcpServer } from './server.ts';

const mcpParams = { schema: { hide: true, params: tenantParamsSchema } };

/** Stateless serving has no session to stream or close. Occupying GET/DELETE
 * with 405 (not Fastify's 404) is what tells an MCP client this URL is the
 * endpoint — Streamable HTTP treats 404 as "no such server". */
function methodNotAllowed(reply: FastifyReply) {
  return reply
    .status(405)
    .header('Allow', 'POST')
    .send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
}

/**
 * Stateless mode (`sessionIdGenerator: undefined`): a fresh McpServer +
 * transport per request, no session persisted between calls. Fastify's own
 * response handling is bypassed via reply.hijack(): the transport writes
 * straight to the underlying Node response.
 *
 * The tenant is a path parameter, the same way every REST route that is
 * scoped to one carries it — never a tool argument.
 */
function registerMcpRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.post('/mcp/:tenant', mcpParams, async (request, reply) => {
    reply.hijack();

    const server = buildMcpServer(app, request.params.tenant);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  typed.get('/mcp/:tenant', mcpParams, async (_request, reply) => methodNotAllowed(reply));
  typed.delete('/mcp/:tenant', mcpParams, async (_request, reply) => methodNotAllowed(reply));
}

export default fp(registerMcpRoutes, { name: 'mcp-route', dependencies: ['env', 'services'] });
