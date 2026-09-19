import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url:
      process.env.GATEWAY_DATABASE_URL ??
      'postgres://admin:ops-ahead-dev@localhost:5432/gateway',
  },
});
