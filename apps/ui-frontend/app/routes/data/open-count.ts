import { fetchOpenAlertCount } from '~/clickhouse.server.ts';
import { dataResponse } from '~/data-response.server.ts';
import type { Route } from './+types/open-count';

export async function loader({ request, params }: Route.LoaderArgs) {
  return dataResponse(request, params.tenant, () => fetchOpenAlertCount());
}
