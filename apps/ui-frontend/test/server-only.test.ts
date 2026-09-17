import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = join(import.meta.dirname, '..', 'app');
const clientBuildDir = join(import.meta.dirname, '..', 'build', 'client');

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? await walk(path) : [path];
    }),
  );
  return files.flat();
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

const SERVER_ONLY_MODULES = [
  'clickhouse.server',
  'config.server',
  'dashboard.server',
  'metrics.server',
  'model-serving.server',
  'queue.server',
];

describe('server-only modules', () => {
  it('are imported only by route modules, never by shared client code', async () => {
    const sources = (await walk(appDir)).filter(path => /\.(ts|tsx)$/.test(path));

    for (const path of sources) {
      // A route module's loader is stripped from the browser bundle; anything
      // else in app/ ships to the client as-is. root.tsx is one too — it
      // carries the loader behind the chrome every screen renders.
      const isRouteModule =
        path.includes(join('app', 'routes')) || path.endsWith(join('app', 'root.tsx'));
      if (isRouteModule || SERVER_ONLY_MODULES.some(name => path.includes(name))) continue;

      const source = await readFile(path, 'utf8');
      for (const serverModule of SERVER_ONLY_MODULES) {
        expect(source, `${path} imports ${serverModule}`).not.toContain(serverModule);
      }
    }
  });

  // Only meaningful once `npm run build` has produced build/client; skipped
  // otherwise so `npm run test` stays runnable on its own.
  it('leave no ClickHouse client code or credential in the client bundle', async ctx => {
    if (!(await exists(clientBuildDir))) ctx.skip();

    const assets = (await walk(clientBuildDir)).filter(path => path.endsWith('.js'));
    expect(assets.length).toBeGreaterThan(0);

    for (const path of assets) {
      const bundle = await readFile(path, 'utf8');
      expect(bundle).not.toContain('@clickhouse/client');
      expect(bundle).not.toContain('gold_kpi_projection');
      expect(bundle).not.toContain('CLICKHOUSE_URL');
    }
  });
});
