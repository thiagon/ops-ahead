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
 *
 * Authorization is the Bearer token's, never the cookie's: an MCP client is
 * not a browser, and the 401 carries the RFC 9728 pointer it reads to find
 * the authorization server.
 */
function registerMcpRoutes(app: FastifyInstance): void {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  function unauthorized(reply: FastifyReply) {
    const metadata = `${app.env.PUBLIC_URL.replace(/\/$/, '')}/.well-known/oauth-protected-resource`;
    return reply
      .status(401)
      .header('www-authenticate', `Bearer realm="gateway", resource_metadata="${metadata}"`)
      .send({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized.' },
        id: null,
      });
  }

  typed.post('/mcp/:tenant', mcpParams, async (request, reply) => {
    const auth = request.auth;
    if (auth.kind !== 'user') return unauthorized(reply);
    if (!auth.tenants.includes(request.params.tenant)) {
      return reply.status(403).send({
        jsonrpc: '2.0',
        error: { code: -32003, message: 'Forbidden.' },
        id: null,
      });
    }
    await app.services.tenants.ensure(request.params.tenant);

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

export default fp(registerMcpRoutes, {
  name: 'mcp-route',
  dependencies: ['env', 'services', 'auth'],
});
