import { McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { analysisRequestSchema } from '../../services/analyses/schema.ts';

/**
 * Hand-wired: no Node equivalent of Python's `fastapi-mcp`, so each tool is
 * declared by hand — but both call the exact same functions the REST routes
 * call, so validation/dispatch is never duplicated between REST and MCP.
 */
export function buildMcpServer(app: FastifyInstance): McpServer {
  const server = new McpServer({
    name: app.env.SERVICE_NAME,
    version: app.env.SERVICE_VERSION,
  });

  server.registerTool(
    'start_analysis',
    {
      title: 'Start analysis',
      description:
        'Runs a business analysis (volume_forecast, breach_risk, kpi_projection, external_event_detection, data_refresh, data_quality_check) without needing kubeconfig, Argo, or Kafka knowledge. Returns an id immediately; poll get_analysis_status for progress.',
      inputSchema: analysisRequestSchema,
    },
    async args => {
      const result = await app.services.analyses.start(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'get_analysis_status',
    {
      title: 'Get analysis status',
      description: 'Looks up the status of a previously started analysis by id.',
      inputSchema: z.object({
        id: z.string().describe('The id returned by start_analysis'),
      }),
    },
    async ({ id }) => {
      const status = await app.services.analyses.getStatus(id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status) }] };
    },
  );

  return server;
}
