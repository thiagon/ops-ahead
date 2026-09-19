import { metrics } from '~/metrics.server.ts';

export async function loader() {
  const { registry } = metrics;
  return new Response(await registry.metrics(), {
    headers: { 'Content-Type': registry.contentType },
  });
}
