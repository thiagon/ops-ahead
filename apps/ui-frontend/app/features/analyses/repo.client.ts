import { redirect } from 'react-router';
import { gatewayFetch, loginUrl } from '~/features/auth/gateway.client.ts';
import { createAnalysesRepo } from './repo.ts';

/** Reads for one tenant, issued by the browser against the public gateway. */
export function analysesRepo(tenant: string) {
  return createAnalysesRepo(tenant, async (path, init) => {
    const response = await gatewayFetch(path, init);
    if (response.status === 401) {
      throw redirect(loginUrl(`${window.location.pathname}${window.location.search}`));
    }
    return response;
  });
}
