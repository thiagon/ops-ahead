import { McpServer } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import { rulesJsonSchema } from '../../services/rules/schema.ts';
import {
  analysisParamsSchema,
  analysisRequestSchema,
  deadlineSetSchema,
  getMappingInputSchema,
  registerSourceInputSchema,
  rotateSourceSecretInputSchema,
  setMappingInputSchema,
  setSourceStatusInputSchema,
  targetSetSchema,
} from './schema.ts';

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

/**
 * Hand-wired: no Node equivalent of Python's `fastapi-mcp`, so each tool is
 * declared by hand — but both call the exact same functions the REST routes
 * call, so validation/dispatch is never duplicated between REST and MCP.
 *
 * `tenant` is closed over from `/mcp/:tenant`. Tools never take it as an
 * argument, so one connection operates one tenant
 * (domain/ubiquitous-language.md#tenant).
 */
export function buildMcpServer(app: FastifyInstance, tenant: string): McpServer {
  const server = new McpServer({
    name: app.env.SERVICE_NAME,
    version: app.env.SERVICE_VERSION,
  });

  const { analyses, sources, rules } = app.services;

  server.registerTool(
    'start_analysis',
    {
      title: 'Start analysis',
      description:
        'Runs a business analysis (volume_forecast, breach_risk, kpi_projection, external_event_detection, data_refresh, data_quality_check) without needing kubeconfig, Argo, or Kafka knowledge. Returns an id immediately; poll get_analysis_status for progress.',
      inputSchema: analysisRequestSchema,
    },
    // An MCP tool call is a person asking, the same as the REST route a
    // session reaches — the client's own token is what authenticated it.
    async args => jsonResult(await analyses.start(args, { kind: 'user', tenants: [tenant] })),
  );

  server.registerTool(
    'get_analysis_status',
    {
      title: 'Get analysis status',
      description: 'Looks up the status of a previously started analysis by id.',
      inputSchema: analysisParamsSchema,
    },
    async ({ id }) => jsonResult(await analyses.getStatus(id, { kind: 'user', tenants: [tenant] })),
  );

  server.registerTool(
    'list_sources',
    {
      title: 'List sources',
      description: "List this tenant's registered sources. Secrets are never included.",
    },
    async () => jsonResult(await sources.listByTenant(tenant)),
  );

  server.registerTool(
    'register_source',
    {
      title: 'Register source',
      description:
        'Register a source under this tenant. Answers with the signing secret this once and never again.',
      inputSchema: registerSourceInputSchema,
    },
    async ({ source, intake, secret }) =>
      jsonResult(await sources.register(tenant, source, intake, secret)),
  );

  server.registerTool(
    'set_source_status',
    {
      title: 'Set source status',
      description:
        'Turn a source off or back on. A disabled source keeps its configuration and its secret; its webhooks answer 403 until it is enabled again.',
      inputSchema: setSourceStatusInputSchema,
    },
    async ({ source, status }) => jsonResult(await sources.setStatus(tenant, source, status)),
  );

  server.registerTool(
    'rotate_source_secret',
    {
      title: 'Rotate source secret',
      description:
        "Rotate a source's secret. The previous one stops being accepted; the new value is answered this once and never again.",
      inputSchema: rotateSourceSecretInputSchema,
    },
    async ({ source, secret }) => jsonResult(await sources.rotate(tenant, source, secret)),
  );

  server.registerTool(
    'set_mapping',
    {
      title: 'Set origin mapping',
      description:
        "Publish one origin's field bindings and value dictionary. Bindings and dictionary are one record: a translated value means nothing without the field it was read from.",
      inputSchema: setMappingInputSchema,
    },
    async ({ source, ...mapping }) => jsonResult(await rules.setMapping(tenant, source, mapping)),
  );

  server.registerTool(
    'set_deadlines',
    {
      title: 'Set deadlines',
      description: "Publish this tenant's contractual deadlines per severity.",
      inputSchema: deadlineSetSchema,
    },
    async args => jsonResult(await rules.setDeadlines(tenant, args)),
  );

  server.registerTool(
    'set_targets',
    {
      title: 'Set KPI targets',
      description: "Publish this tenant's KPI achievement targets.",
      inputSchema: targetSetSchema,
    },
    async args => jsonResult(await rules.setTargets(tenant, args)),
  );

  server.registerTool(
    'get_rules_schema',
    {
      title: 'Rules JSON Schema',
      description:
        'JSON Schema for mapping, deadline and target documents — the same contracts REST and MCP validate.',
    },
    async () => jsonResult(rulesJsonSchema()),
  );

  server.registerTool(
    'get_mapping',
    {
      title: 'Get origin mapping',
      description: 'Read the current mapping for an origin of this tenant.',
      inputSchema: getMappingInputSchema,
    },
    async ({ source }) => jsonResult(await rules.getMapping(tenant, source)),
  );

  server.registerTool(
    'get_deadlines',
    {
      title: 'Get deadlines',
      description: "Read this tenant's current contractual deadlines.",
    },
    async () => jsonResult(await rules.getDeadlines(tenant)),
  );

  server.registerTool(
    'get_targets',
    {
      title: 'Get KPI targets',
      description: "Read this tenant's current KPI achievement targets.",
    },
    async () => jsonResult(await rules.getTargets(tenant)),
  );

  server.registerTool(
    'history_mapping',
    {
      title: 'Mapping history',
      description:
        'The last ten published mappings for an origin, newest first. Republish one by calling set_mapping with its body.',
      inputSchema: getMappingInputSchema,
    },
    async ({ source }) => jsonResult(await rules.listMappingHistory(tenant, source)),
  );

  server.registerTool(
    'history_deadlines',
    {
      title: 'Deadline history',
      description:
        'The last ten published deadline documents, newest first. Republish one by calling set_deadlines with its body.',
    },
    async () => jsonResult(await rules.listDeadlineHistory(tenant)),
  );

  server.registerTool(
    'history_targets',
    {
      title: 'KPI target history',
      description:
        'The last ten published target documents, newest first. Republish one by calling set_targets with its body.',
    },
    async () => jsonResult(await rules.listTargetHistory(tenant)),
  );

  return server;
}
