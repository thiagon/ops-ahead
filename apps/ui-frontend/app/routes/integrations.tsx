import { useState } from 'react';
import { Form, Link, redirect, useNavigation } from 'react-router';
import { Badge } from '~/components/Badge';
import { Field, GhostButton, inputClass, SubmitButton } from '~/components/form';
import { ChevronRightIcon, PlusIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import {
  ConfigApiError,
  createIntegration,
  type Integration,
  listIntegrations,
} from '~/features/config/api.server.ts';
import {
  CONTRACT_FIELDS,
  DOMAIN_VALUES,
  INTAKE_HINT,
  INTAKE_LABEL,
  type Intake,
  type MappingField,
} from '~/features/config/types.ts';
import type { Route } from './+types/integrations';

export function meta() {
  return [{ title: 'Integrações · Ops Ahead' }];
}

/** Domain values of a translated field that no origin value maps onto yet. */
function countUncovered(integration: Integration): number {
  return CONTRACT_FIELDS[integration.intake].reduce((total, field) => {
    if (!field.translated) return total;
    const known = DOMAIN_VALUES[field.field as MappingField];
    if (known.length === 0) return total;
    const mapped = new Set(
      (integration.mappings[field.field as MappingField] ?? []).map(entry => entry.to),
    );
    return total + known.filter(value => !mapped.has(value)).length;
  }, 0);
}

/** Contract fields required by this intake that no payload path is bound to. */
function countMissing(integration: Integration): number {
  const bound = new Map(integration.bindings.map(binding => [binding.field, binding.path]));
  return CONTRACT_FIELDS[integration.intake].filter(
    field => field.required && !bound.get(field.field),
  ).length;
}

export async function loader() {
  const integrations = await listIntegrations();

  return {
    integrations: integrations.map(integration => ({
      source: integration.source,
      intake: integration.intake,
      enabled: integration.enabled,
      isDraft: integration.dictionaryStatus === 'draft',
      missingFields: countMissing(integration),
      uncovered: countUncovered(integration),
    })),
  };
}

/**
 * The new integration's signing key is minted here and shown once, on the
 * screen the redirect lands on.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const source = String(form.get('source') ?? '').trim();

  try {
    await createIntegration({
      source,
      intake: form.get('intake') as Intake,
      envelopeVersion: 'v1',
    });
  } catch (error) {
    if (error instanceof ConfigApiError) return { error: error.detail };
    throw error;
  }

  return redirect(`/integracoes/${encodeURIComponent(source)}`);
}

function Status({
  integration,
}: {
  integration: Route.ComponentProps['loaderData']['integrations'][number];
}) {
  if (integration.missingFields > 0) {
    return <Badge tone="red">{integration.missingFields} campos obrigatórios em falta</Badge>;
  }
  if (integration.uncovered > 0) {
    return <Badge tone="amber">{integration.uncovered} valores sem mapeamento</Badge>;
  }
  if (integration.isDraft) return <Badge tone="amber">Rascunho</Badge>;
  return <Badge tone="green">Pronta</Badge>;
}

export default function Integrations({ loaderData, actionData }: Route.ComponentProps) {
  const { integrations } = loaderData;
  const [creating, setCreating] = useState(false);
  const saving = useNavigation().state === 'submitting';

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title="Integrações"
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
          <Form method="post" className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="source"
                label="Nome do sistema"
                hint="Como você chama a origem: service_now, zabbix."
              >
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

              <Field id="intake" label="O que ele envia">
                {id => (
                  <select id={id} name="intake" className={inputClass} defaultValue="alert">
                    <option value="alert">{INTAKE_LABEL.alert}</option>
                    <option value="monitor">{INTAKE_LABEL.monitor}</option>
                  </select>
                )}
              </Field>
            </div>

            {actionData?.error && <p className="text-accent-red text-sm">{actionData.error}</p>}

            <div>
              <SubmitButton pending={saving}>Criar integração</SubmitButton>
            </div>
          </Form>
        </Panel>
      )}

      <Panel>
        {integrations.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-text-muted">Nenhuma integração cadastrada.</p>
            <p className="mt-1 text-text-dim text-xs">
              Cadastre a primeira para começar a receber eventos.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {integrations.map(integration => (
              <Link
                key={integration.source}
                to={`/integracoes/${integration.source}`}
                className="flex flex-col gap-3 rounded-lg border border-border-base bg-bg-elevated p-4 transition-colors hover:border-signal-blue/40 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-base text-text-light">
                      {integration.source}
                    </span>
                    <Badge tone={integration.intake === 'alert' ? 'amber' : 'blue'}>
                      {INTAKE_LABEL[integration.intake]}
                    </Badge>
                    {!integration.enabled && <Badge tone="neutral">PAUSADA</Badge>}
                  </div>
                  <span className="text-text-dim text-xs">{INTAKE_HINT[integration.intake]}</span>
                </div>

                <div className="flex shrink-0 items-center gap-4">
                  <Status integration={integration} />
                  <ChevronRightIcon className="h-5 w-5 text-text-dim" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </main>
  );
}
