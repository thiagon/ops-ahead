import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../../../helpers/server.ts';

const mapping = {
  source: 'itsm',
  intake: 'alert',
  version: 'v1',
  bindings: [{ field: 'status', path: 'fields.status' }],
  mappings: { status: { Aberto: 'open' } },
};

/** The transport always answers over SSE, even for a single response — pull
 * the JSON-RPC payload out of the `data:` line. */
async function rpc(
  baseUrl: string,
  tenant: string,
  method: string,
  params: Record<string, unknown>,
) {
  const res = await fetch(`${baseUrl}/mcp/${tenant}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.text();
  const dataLine = body.split('\n').find(line => line.startsWith('data: '));
  return { status: res.status, message: JSON.parse(dataLine?.slice('data: '.length) ?? '{}') };
}

async function callTool(
  baseUrl: string,
  tenant: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return rpc(baseUrl, tenant, 'tools/call', { name, arguments: args });
}

function toolText(message: { result: { content: [{ text: string }] } }) {
  return JSON.parse(message.result.content[0].text);
}

describe('MCP over http', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('start_analysis publishes through the same service the REST route uses and returns an id', async () => {
    const { status, message } = await callTool(server.baseUrl, 'locaweb', 'start_analysis', {
      analysis: 'data_refresh',
    });

    expect(status).toBe(200);
    expect(toolText(message).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('start_analysis rejects a volume_forecast missing split dates, same schema as REST', async () => {
    const { message } = await callTool(server.baseUrl, 'locaweb', 'start_analysis', {
      analysis: 'volume_forecast',
    });

    expect(message.result.isError).toBe(true);
  });

  it('get_analysis_status errors for an id that was never started', async () => {
    const { message } = await callTool(server.baseUrl, 'locaweb', 'get_analysis_status', {
      id: 'never-seen',
    });

    expect(message.result.isError).toBe(true);
  });

  it("list_sources returns this tenant's sources and never another tenant's", async () => {
    const locaweb = await callTool(server.baseUrl, 'locaweb', 'list_sources');
    const other = await callTool(server.baseUrl, 'outro-tenant', 'list_sources');

    expect(toolText(locaweb.message)).toContainEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
    });
    expect(toolText(other.message)).toEqual([]);
  });

  it('register_source binds the URL tenant, not an argument', async () => {
    const { message } = await callTool(server.baseUrl, 'locaweb', 'register_source', {
      source: 'datadog',
      intake: 'monitor',
    });

    expect(toolText(message)).toEqual({
      source: { tenant_id: 'locaweb', source: 'datadog', intake: 'monitor', status: 'active' },
      secret: expect.any(String),
    });
  });

  it('rejects tenant in a tool payload — it is not an argument', async () => {
    const { message } = await callTool(server.baseUrl, 'locaweb', 'register_source', {
      tenant: 'outro-tenant',
      source: 'pagerduty',
      intake: 'alert',
    });

    expect(message.result.isError).toBe(true);
  });

  it('set_mapping and set_deadlines key the record with the URL tenant', async () => {
    const mappingResult = await callTool(server.baseUrl, 'locaweb', 'set_mapping', mapping);
    const deadlines = await callTool(server.baseUrl, 'outro-tenant', 'set_deadlines', {
      deadlines: [{ severity: 1, seconds: 14400 }],
    });

    expect(toolText(mappingResult.message)).toEqual({
      key: 'locaweb:itsm',
      topic: 'rules.mapping',
    });
    expect(toolText(deadlines.message)).toEqual({ key: 'outro-tenant', topic: 'rules.deadline' });
  });

  it('set_targets publishes through the same service the REST route uses', async () => {
    const { message } = await callTool(server.baseUrl, 'locaweb', 'set_targets', {
      targets: [{ severities: [1, 2], max_breaches: 5, achievement_pct: 95 }],
    });

    expect(toolText(message)).toEqual({ key: 'locaweb', topic: 'rules.target' });
  });

  it('set_source_status and rotate_source_secret call the same services as REST', async () => {
    const status = await callTool(server.baseUrl, 'locaweb', 'set_source_status', {
      source: 'zabbix',
      status: 'disabled',
    });
    const rotated = await callTool(server.baseUrl, 'locaweb', 'rotate_source_secret', {
      source: 'itsm',
    });

    expect(toolText(status.message)).toEqual({
      tenant_id: 'locaweb',
      source: 'zabbix',
      intake: 'monitor',
      status: 'disabled',
    });
    expect(toolText(rotated.message).secret).toEqual(expect.any(String));
    expect(toolText(rotated.message).source).toEqual({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      status: 'active',
    });
  });

  it('GET and DELETE answer 405 so the URL is still the MCP endpoint', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await fetch(`${server.baseUrl}/mcp/locaweb`, {
        method,
        headers: { accept: 'application/json, text/event-stream' },
      });

      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
    }
  });

  it('tools/list never advertises tenant as an input', async () => {
    const { message } = await rpc(server.baseUrl, 'locaweb', 'tools/list', {});

    const names = message.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'start_analysis',
        'get_analysis_status',
        'list_sources',
        'register_source',
        'set_source_status',
        'rotate_source_secret',
        'set_mapping',
        'set_deadlines',
        'set_targets',
        'get_mapping',
        'get_deadlines',
        'get_targets',
        'history_mapping',
        'history_deadlines',
        'history_targets',
      ]),
    );
    for (const tool of message.result.tools) {
      expect(tool.inputSchema?.properties ?? {}).not.toHaveProperty('tenant');
    }
  });

  it('get_deadlines returns the current document; history is the last ten to PUT again', async () => {
    await callTool(server.baseUrl, 'locaweb', 'set_deadlines', {
      deadlines: [{ severity: 1, seconds: 14400 }],
    });
    await callTool(server.baseUrl, 'locaweb', 'set_deadlines', {
      deadlines: [{ severity: 1, seconds: 7200 }],
    });

    const current = await callTool(server.baseUrl, 'locaweb', 'get_deadlines');
    const listed = await callTool(server.baseUrl, 'locaweb', 'history_deadlines');

    expect(toolText(current.message)).toEqual({ deadlines: [{ severity: 1, seconds: 7200 }] });
    expect(toolText(listed.message)[0]).toMatchObject({
      deadlines: [{ severity: 1, seconds: 7200 }],
      id: expect.any(Number),
    });
  });
});
