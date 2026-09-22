import { requireTenantAccess } from '~/features/auth/session.server.ts';
import { withTenant } from '~/features/config/repo.server.ts';

function causeOf(error: Error): string | undefined {
  if (error.cause instanceof Error) return error.cause.message;
  if (typeof error.cause === 'string') return error.cause;
  return undefined;
}

async function errorResponse(error: unknown): Promise<Response> {
  if (error instanceof Response) {
    const location = error.headers.get('Location');
    if (location && error.status >= 300 && error.status < 400) {
      return Response.json({ redirect: location }, { status: 401 });
    }
    const text = await error.text();
    return Response.json({ error: text || error.statusText }, { status: error.status });
  }

  const err = error instanceof Error ? error : new Error(String(error));
  return Response.json(
    { error: err.message, cause: causeOf(err), name: err.name },
    { status: 500 },
  );
}

/**
 * Runs a screen's server read and always answers JSON, including the failure.
 * The browser fetches this URL so the status and body are visible there.
 */
export async function dataResponse(
  request: Request,
  tenant: string | undefined,
  work: () => Promise<unknown>,
): Promise<Response> {
  if (!tenant) return Response.json({ error: 'Tenant ausente.' }, { status: 400 });

  try {
    await requireTenantAccess(request, tenant);
    const body = await withTenant(request, tenant, work);
    return Response.json(body);
  } catch (error) {
    return await errorResponse(error);
  }
}
