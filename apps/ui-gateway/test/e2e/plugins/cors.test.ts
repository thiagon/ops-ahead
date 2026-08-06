import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/server.ts';

const ALLOWED = 'http://ui.ops-ahead.localtest.me';
const OTHER = 'http://evil.example.com';

describe('cors over http', () => {
  let server: TestServer;

  afterEach(async () => {
    await server?.close();
    delete process.env.CORS_ORIGINS;
  });

  it('reflects any origin when no allowlist is configured', async () => {
    server = await startTestServer();

    const res = await fetch(`${server.baseUrl}/health`, { headers: { origin: OTHER } });

    expect(res.headers.get('access-control-allow-origin')).toBe(OTHER);
  });

  it('answers only the configured origins', async () => {
    process.env.CORS_ORIGINS = JSON.stringify([ALLOWED, 'https://ops-ahead.example.com']);
    server = await startTestServer();

    const allowed = await fetch(`${server.baseUrl}/health`, { headers: { origin: ALLOWED } });
    const other = await fetch(`${server.baseUrl}/health`, { headers: { origin: OTHER } });

    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});
