import { isRouteErrorResponse, useRevalidator } from 'react-router';
import { AlertTriangleIcon, RefreshIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';

/**
 * What a screen shows when its loader could not answer. It renders inside the
 * route, so the sidebar and the rest of the app stay usable — a service being
 * down takes out the screen that needs it, never the navigation.
 */

/** What the person can do about it, which is what decides the wording. */
type Kind = 'unavailable' | 'notFound' | 'unexpected';

export function classify(error: unknown): { kind: Kind; status?: number } {
  if (isRouteErrorResponse(error)) {
    return { kind: error.status === 404 ? 'notFound' : 'unexpected', status: error.status };
  }
  // A loader that could not reach its service at all — down or unreachable,
  // rather than answering an error. The server sees the underlying cause
  // (ECONNREFUSED) and the client only the wrapper ("fetch failed"), so both
  // spellings must land on the same wording or hydration mismatches.
  if (
    error instanceof Error &&
    /fetch failed|ECONNREFUSED|ENOTFOUND|timeout|aborted/i.test(
      `${error.message} ${(error.cause as Error | undefined)?.message ?? ''}`,
    )
  ) {
    return { kind: 'unavailable' };
  }
  return { kind: 'unexpected' };
}

export function RouteError({
  error,
  title,
  /** The service this screen reads from, named as the person would say it. */
  service,
}: {
  error: unknown;
  title: string;
  service: string;
}) {
  const revalidator = useRevalidator();
  const { kind, status } = classify(error);
  const retrying = revalidator.state === 'loading';

  const copy = {
    unavailable: {
      heading: `${service} não respondeu`,
      body: 'A tela volta sozinha assim que o serviço estiver de pé. O restante do sistema continua funcionando.',
    },
    notFound: {
      heading: 'Não encontrado',
      body: 'O que você procurou não existe mais, ou o endereço está errado.',
    },
    unexpected: {
      heading: 'Não foi possível carregar esta tela',
      body: `Algo falhou ao buscar os dados${status ? ` (${status})` : ''}.`,
    },
  }[kind];

  return (
    <main className="p-6 sm:p-8">
      <PageHeader title={title} />

      <Panel>
        <div className="flex flex-col items-start gap-3 py-6">
          <div className="flex items-center gap-2.5">
            <AlertTriangleIcon className="h-5 w-5 shrink-0 text-accent-red" />
            <h2 className="font-semibold text-lg text-text-light">{copy.heading}</h2>
          </div>

          <p className="max-w-prose text-sm text-text-muted">{copy.body}</p>

          {kind !== 'notFound' && (
            <button
              type="button"
              onClick={() => revalidator.revalidate()}
              disabled={retrying}
              className="mt-1 flex h-9 items-center gap-2 rounded-lg border border-border-base px-3 font-medium text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-light disabled:opacity-50"
            >
              <RefreshIcon className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Tentando…' : 'Tentar de novo'}
            </button>
          )}
        </div>
      </Panel>
    </main>
  );
}
