import { McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { triggerRequestSchema } from '../trigger/schema.ts';
import { triggerAnalysis } from '../trigger/service.ts';

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
    'trigger_analysis',
    {
      title: 'Trigger analysis',
      description:
        'Runs a business analysis (volume_forecast, breach_risk, data_refresh, data_quality_check) without needing kubeconfig, Argo, or Kafka knowledge. Returns a run_id immediately; poll get_run_status for progress.',
      // The same discriminated union the REST route validates against — a
      // caller that skips a required split date for volume_forecast/
      // breach_risk gets rejected by the SDK before the handler even runs.
      inputSchema: triggerRequestSchema,
    },
    async args => {
      const topics = { ml: app.env.KAFKA_TOPIC_ML, data: app.env.KAFKA_TOPIC_DATA };
      const result = await triggerAnalysis(app.kafka, topics, args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Get run status',
      description: 'Looks up the status of a previously triggered run by run_id.',
      inputSchema: z.object({
        run_id: z.string().describe('The run_id returned by trigger_analysis'),
      }),
    },
    async ({ run_id }) => {
      const status = app.runsService.getStatus(run_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status) }] };
    },
  );

  return server;
}
