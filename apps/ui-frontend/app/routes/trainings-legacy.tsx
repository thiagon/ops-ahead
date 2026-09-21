import { redirect } from 'react-router';
import { analysesPath } from '~/paths';
import type { Route } from './+types/trainings-legacy';

export function loader({ params }: Route.LoaderArgs) {
  return redirect(analysesPath(params.tenant));
}
