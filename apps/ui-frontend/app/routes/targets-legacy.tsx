import { redirect } from 'react-router';
import { targetsPath } from '~/paths';
import type { Route } from './+types/targets-legacy';

export function loader({ params }: Route.LoaderArgs) {
  return redirect(targetsPath(params.tenant));
}
