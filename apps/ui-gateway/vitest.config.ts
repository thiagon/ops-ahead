import { defineConfig } from 'vitest/config';

const server = { deps: { inline: ['@fastify/autoload'] } };

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 15_000,
          server,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 15_000,
          server,
        },
      },
    ],
    coverage: {
      include: ['src/**'],
    },
  },
});
