import { takeSecretFlash } from '~/features/config/secret-flash.server.ts';
import type { Route } from './+types/secret-flash';

/** One-time signing key carried in the flash cookie, read from the browser. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const source = params.source;
  if (!source) return Response.json({ flashedSecret: null });

  const { secret, clearHeader } = await takeSecretFlash(request, source);
  return Response.json(
    { flashedSecret: secret },
    { headers: clearHeader ? { 'Set-Cookie': clearHeader } : undefined },
  );
}
