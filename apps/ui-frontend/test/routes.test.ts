import { describe, expect, it } from 'vitest';
import { parseConfig } from '../app/config.server.ts';
import { loader as healthLoader } from '../app/routes/health.ts';
import { loader as metricsLoader } from '../app/routes/metrics.ts';

describe('config', () => {
  it('reads the whole connection from a single URL', () => {
    const config = parseConfig({
      CLICKHOUSE_URL: 'http://ops_ahead:secret@clickhouse.data.svc.cluster.local:8123/ops_ahead',
    });

    expect(config.CLICKHOUSE_URL).toContain('clickhouse.data.svc.cluster.local:8123');
  });

  it('rejects a CLICKHOUSE_URL that is not on the HTTP interface', () => {
    expect(() => parseConfig({ CLICKHOUSE_URL: 'clickhouse.data:8123' })).toThrow();
    expect(() => parseConfig({ CLICKHOUSE_URL: 'clickhouse://user@host:9000/db' })).toThrow();
  });
});

describe('operational routes', () => {
  it('/health answers with the same shape as the other ns:ui apps', async () => {
    const response = await healthLoader();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'ui-frontend' });
    expect(typeof body.uptime).toBe('number');
  });

  it('/metrics answers in Prometheus text format', async () => {
    const response = await metricsLoader();
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('process_cpu_seconds_total');
  });
});
