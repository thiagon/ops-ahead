import { redirect } from 'react-router';
import { gatewayFetch, loginUrl } from '~/features/auth/gateway.client.ts';
import { createConfigRepo } from './repo.ts';

/** Reads and writes for one tenant, issued by the browser against the public gateway. */
export function configRepo(tenant: string) {
  return createConfigRepo(tenant, async (path, init) => {
    const response = await gatewayFetch(path, init);
    if (response.status === 401) {
      throw redirect(loginUrl(`${window.location.pathname}${window.location.search}`));
    }
    return response;
  });
}
