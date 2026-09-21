import { loadDashboard } from '~/dashboard.server.ts';
import { dataResponse } from '~/data-response.server.ts';
import type { Route } from './+types/manager';

export async function loader({ request, params }: Route.LoaderArgs) {
  return dataResponse(request, params.tenant, () => loadDashboard());
}
