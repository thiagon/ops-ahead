import { defineConfig } from 'vitest/config';

const server = { deps: { inline: ['@fastify/autoload'] } };
const execArgv = ['--conditions=source'];

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    execArgv,
    projects: [
      {
        resolve: { conditions: ['source'] },
        ssr: { resolve: { conditions: ['source'] } },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
          execArgv,
        },
      },
      {
        resolve: { conditions: ['source'] },
        ssr: { resolve: { conditions: ['source'] } },
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 15_000,
          server,
          execArgv,
        },
      },
      {
        resolve: { conditions: ['source'] },
        ssr: { resolve: { conditions: ['source'] } },
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 15_000,
          server,
          execArgv,
        },
      },
    ],
    coverage: {
      include: ['src/**'],
    },
  },
});
