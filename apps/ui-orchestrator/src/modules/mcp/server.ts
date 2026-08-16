import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getRunStatus } from '../runs/service.ts';
import { triggerRequestSchema } from '../trigger/schema.ts';
import { triggerAnalysis } from '../trigger/service.ts';

/**
 * Hand-wired: there is no Node equivalent of Python's `fastapi-mcp` (which
 * derived tools automatically from FastAPI routes), so each tool is declared
 * by hand — but both call the exact same service functions the REST routes
 * call (src/modules/trigger/service.ts, src/modules/runs/service.ts), so
 * validation/dispatch logic is never duplicated between REST and MCP.
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
      inputSchema: {
        analysis: z.enum(['volume_forecast', 'breach_risk', 'data_refresh', 'data_quality_check']),
        train_end: z
          .string()
          .optional()
          .describe('Required for volume_forecast/breach_risk, YYYY-MM-DD'),
        validation_end: z
          .string()
          .optional()
          .describe('Required for volume_forecast/breach_risk, YYYY-MM-DD'),
        holdout_end: z
          .string()
          .optional()
          .describe('Required for volume_forecast/breach_risk, YYYY-MM-DD'),
      },
    },
    async args => {
      // Re-validated through the same discriminated schema the REST route
      // uses, so a caller that skips a required split date for
      // volume_forecast/breach_risk gets the same rejection either way.
      const parsed = triggerRequestSchema.safeParse(args);
      if (!parsed.success) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: parsed.error.message }],
        };
      }

      const result = await triggerAnalysis(app, parsed.data);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Get run status',
      description: 'Looks up the status of a previously triggered run by run_id.',
      inputSchema: {
        run_id: z.string().describe('The run_id returned by trigger_analysis'),
      },
    },
    async ({ run_id }) => {
      const status = getRunStatus(app, run_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(status) }] };
    },
  );

  return server;
}
