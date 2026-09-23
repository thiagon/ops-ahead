import { useRouteLoaderData } from 'react-router';

/** As the gateway's `/auth/me` reports it — `viewer` reads and changes nothing. */
export type Role = 'operator' | 'viewer';

/** Only an explicit `operator` writes; an identity without a role reads. */
export function canWrite(identity: { role?: string }): boolean {
  return identity.role === 'operator';
}

/**
 * Whether the screen offers its writes. The gateway refuses them either way;
 * this only keeps a viewer from being handed a control that answers 403.
 */
export function useCanWrite(): boolean {
  const layout = useRouteLoaderData('routes/tenant') as { canWrite?: boolean } | undefined;
  return layout?.canWrite ?? false;
}
