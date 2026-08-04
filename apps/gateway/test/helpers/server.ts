import { buildApp } from '../../src/app.ts';
import { stubKafka } from './app.ts';

export interface TestServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const app = buildApp({ logger: false });
  stubKafka(app);
  await app.listen({ port: 0, host: '127.0.0.1' });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    await app.close();
    throw new Error('test server did not bind to a tcp port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await app.close();
    },
  };
}
