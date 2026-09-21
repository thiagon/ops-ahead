import { redirect } from 'react-router';
import { deadlinesPath } from '~/paths';
import type { Route } from './+types/prazos';

export function loader({ params }: Route.LoaderArgs) {
  return redirect(deadlinesPath(params.tenant));
}
