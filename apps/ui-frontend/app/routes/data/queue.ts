import { dataResponse } from '~/data-response.server.ts';
import { loadQueue } from '~/queue.server.ts';
import type { Route } from './+types/queue';

export async function loader({ request, params }: Route.LoaderArgs) {
  return dataResponse(request, params.tenant, async () => ({ rows: await loadQueue() }));
}
