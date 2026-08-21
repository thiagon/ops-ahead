import { getConfig } from '~/config.server.ts';

export async function loader() {
  const config = getConfig();
  return Response.json({
    status: 'ok' as const,
    service: config.SERVICE_NAME,
    version: config.SERVICE_VERSION,
    uptime: process.uptime(),
  });
}
