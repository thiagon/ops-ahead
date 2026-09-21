import { useMemo, useState } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import { Badge } from '~/components/Badge';
import { Field, GhostButton, inputClass, SubmitButton } from '~/components/form';
import { ChevronRightIcon, GridIcon, PlusIcon, PulseIcon, SearchIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import {
  ConflictError,
  createIntegration,
  listIntegrations,
  withTenant,
} from '~/features/config/repo.server.ts';
import { setSecretFlash } from '~/features/config/secret-flash.server.ts';
import { INTAKE_HINT, INTAKE_LABEL, type Intake } from '~/features/config/types.ts';
import { integrationPath, useTenantSlug } from '~/paths';
import type { Route } from './+types/integrations';

export function meta() {
  return [{ title: 'Entrada · Ops Ahead' }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return withTenant(request, params.tenant, async () => ({
    integrations: await listIntegrations(),
  }));
}

/**
 * The new integration's signing key is minted here and shown once, on the
 * screen the redirect lands on — via a short-lived flash cookie, never the URL.
 */
export async function action({ request, params }: Route.ActionArgs) {
  return withTenant(request, params.tenant, async () => {
    const form = await request.formData();
    const source = String(form.get('source') ?? '').trim();

    let secret: string;
    try {
      ({ secret } = await createIntegration({
        source,
        intake: form.get('intake') as Intake,
      }));
    } catch (error) {
      if (error instanceof ConflictError) return { error: error.message };
      throw error;
    }

    return redirect(integrationPath(params.tenant, source), {
      headers: { 'Set-Cookie': await setSecretFlash(source, secret) },
    });
  });
}

function Status({
  integration,
}: {
  integration: Route.ComponentProps['loaderData']['integrations'][number];
}) {
  if (integration.lifecycle === 'active') {
    return <Badge tone="green">Ativa</Badge>;
  }
  return <Badge tone="neutral">Inativa</Badge>;
}

export default function Integrations({ loaderData, actionData }: Route.ComponentProps) {
  const { integrations } = loaderData;
  const tenant = useTenantSlug();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const saving = useNavigation().state === 'submitting';
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      integrations.filter(integration =>
        needle ? integration.source.toLowerCase().includes(needle) : true,
      ),
    [integrations, needle],
  );

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title="Entrada"
        subtitle="Os sistemas que enviam eventos para cá."
        action={
          <GhostButton onClick={() => setCreating(!creating)}>
            <PlusIcon className="h-4 w-4" />
            Nova integração
          </GhostButton>
        }
      />

      {creating && (
        <Panel className="mb-4">
          <Form method="post" className="flex flex-col gap-5">
            <Field id="source" label="Nome do sistema" hint="O nome da origem, como service_now.">
              {id => (
                <input
                  id={id}
                  name="source"
                  required
                  pattern="[a-z][a-z0-9_]*"
                  placeholder="service_now"
                  className={`${inputClass} font-mono`}
                />
              )}
            </Field>

            <fieldset>
              <legend className="mb-2 font-semibold text-[11px] text-text-dim uppercase tracking-wider">
                Tipo da origem
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 transition-colors has-[:focus-visible]:border-signal-blue/60 has-[:checked]:border-accent-red/50 has-[:checked]:bg-accent-red/10">
                  <input
                    type="radio"
                    name="intake"
                    value="alert"
                    defaultChecked
                    className="sr-only"
                  />
                  <GridIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
                  <span>
                    <span className="block font-medium text-sm text-text-light">
                      {INTAKE_LABEL.alert}
                    </span>
                    <span className="mt-0.5 block text-text-dim text-xs">
                      {INTAKE_HINT.alert}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 transition-colors has-[:focus-visible]:border-signal-blue/60 has-[:checked]:border-signal-blue/50 has-[:checked]:bg-signal-blue/10">
                  <input type="radio" name="intake" value="monitor" className="sr-only" />
                  <PulseIcon className="mt-0.5 h-5 w-5 shrink-0 text-signal-blue" />
                  <span>
                    <span className="block font-medium text-sm text-text-light">
                      {INTAKE_LABEL.monitor}
                    </span>
                    <span className="mt-0.5 block text-text-dim text-xs">{INTAKE_HINT.monitor}</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {actionData?.error && <p className="text-accent-red text-sm">{actionData.error}</p>}

            <div>
              <SubmitButton pending={saving}>Criar integração</SubmitButton>
            </div>
          </Form>
        </Panel>
      )}

      {integrations.length === 0 ? (
        <div className="rounded-lg border border-border-base py-8 text-center">
          <p className="text-sm text-text-muted">Nenhuma integração cadastrada.</p>
          <p className="mt-1 text-text-dim text-xs">
            Cadastre a primeira para começar a receber eventos.
          </p>
        </div>
      ) : (
        <div>
          <label className="mb-3 flex items-center gap-2 rounded-lg border border-border-base bg-bg-tile px-3 py-2 text-sm text-text-muted focus-within:border-signal-blue/40">
            <SearchIcon className="h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filtrar por nome…"
              className="min-w-0 flex-1 bg-transparent text-text-light outline-none placeholder:text-text-dim"
            />
            <span className="shrink-0 font-mono text-text-dim text-xs">
              {visible.length}/{integrations.length}
            </span>
          </label>

          {visible.length === 0 ? (
            <p className="text-sm text-text-muted">Nada bate com “{query.trim()}”.</p>
          ) : (
            <ul className="divide-y divide-border-base rounded-lg border border-border-base">
              {visible.map(integration => (
                <li key={integration.source}>
                  <Link
                    to={integrationPath(tenant, integration.source)}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-tile"
                  >
                    {integration.intake === 'alert' ? (
                      <GridIcon className="h-4 w-4 shrink-0 text-accent-red" />
                    ) : (
                      <PulseIcon className="h-4 w-4 shrink-0 text-signal-blue" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="font-medium text-sm text-text-light">
                          {integration.source}
                        </span>
                        <span className="text-text-dim text-xs">
                          {INTAKE_LABEL[integration.intake]}
                        </span>
                      </div>
                    </div>
                    <Status integration={integration} />
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-text-dim" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Entrada" service="O serviço de configuração" />;
}
