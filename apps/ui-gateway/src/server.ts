import { buildApp } from './app.ts';

const app = buildApp();

try {
  await app.ready();
  await app.listen({ port: app.env.PORT, host: app.env.HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
