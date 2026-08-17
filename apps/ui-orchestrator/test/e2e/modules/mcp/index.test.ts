import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../../../helpers/server.ts';

/** The transport always answers over SSE, even for a single response — pull
 * the JSON-RPC payload out of the `data:` line. */
async function callTool(baseUrl: string, name: string, args: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const body = await res.text();
  const dataLine = body.split('\n').find(line => line.startsWith('data: '));
  return { status: res.status, message: JSON.parse(dataLine?.slice('data: '.length) ?? '{}') };
}

describe('MCP over http', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it('trigger_analysis publishes through the same service the REST route uses and returns a run_id', async () => {
    const { status, message } = await callTool(server.baseUrl, 'trigger_analysis', {
      analysis: 'data_refresh',
    });

    expect(status).toBe(200);
    const content = JSON.parse(message.result.content[0].text);
    expect(content.run_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('trigger_analysis rejects a volume_forecast missing split dates, same schema as REST', async () => {
    const { message } = await callTool(server.baseUrl, 'trigger_analysis', {
      analysis: 'volume_forecast',
    });

    expect(message.result.isError).toBe(true);
  });

  it('get_run_status reports queued for a run with no status yet', async () => {
    const { message } = await callTool(server.baseUrl, 'get_run_status', { run_id: 'never-seen' });

    const content = JSON.parse(message.result.content[0].text);
    expect(content).toEqual({ run_id: 'never-seen', status: 'queued' });
  });
});
