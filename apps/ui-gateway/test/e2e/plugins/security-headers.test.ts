import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../../helpers/server.ts';

describe('security headers over http', () => {
  let server: TestServer;

  afterEach(async () => {
    await server?.close();
    delete process.env.HTTPS_ENABLED;
  });

  it('keeps the docs page on the scheme it was served with', async () => {
    server = await startTestServer();

    const res = await fetch(`${server.baseUrl}/docs`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('strict-transport-security')).toBeNull();
    expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
  });

  it('lets the docs bundle apply its inline stylesheet', async () => {
    server = await startTestServer();

    const res = await fetch(`${server.baseUrl}/docs`);

    expect(res.headers.get('content-security-policy')).toContain(
      "style-src 'self' https: 'unsafe-inline'",
    );
  });

  it('keeps every other route on the scheme it was served with', async () => {
    server = await startTestServer();

    const res = await fetch(`${server.baseUrl}/health`);

    expect(res.headers.get('content-security-policy')).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('asks for the upgrade once TLS terminates in front of the gateway', async () => {
    process.env.HTTPS_ENABLED = 'true';
    server = await startTestServer();

    const docs = await fetch(`${server.baseUrl}/docs`);
    const health = await fetch(`${server.baseUrl}/health`);

    expect(docs.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(health.headers.get('content-security-policy')).toContain('upgrade-insecure-requests');
    expect(health.headers.get('strict-transport-security')).toContain('max-age=');
  });
});
