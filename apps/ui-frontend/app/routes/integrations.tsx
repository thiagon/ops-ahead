import { Link } from 'react-router';
import { Badge } from '~/components/Badge';
import { GhostButton } from '~/components/form';
import { ChevronRightIcon, PlusIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { type Integration, listIntegrations } from '~/features/config/api.server.ts';
import {
  DOMAIN_VALUES,
  INTAKE_HINT,
  INTAKE_LABEL,
  type MappingField,
} from '~/features/config/types.ts';
import type { Route } from './+types/integrations';

export function meta() {
  return [{ title: 'Integrações · Ops Ahead' }];
}

/** Domain values of a translated field that no origin value maps onto yet. */
function countUncovered(integration: Integration): number {
  return integration.bindings.reduce((total, binding) => {
    if (!binding.translated) return total;
    const known = DOMAIN_VALUES[binding.field as MappingField];
    if (known.length === 0) return total;
    const mapped = new Set(
      (integration.mappings[binding.field as MappingField] ?? []).map(entry => entry.to),
    );
    return total + known.filter(value => !mapped.has(value)).length;
  }, 0);
}

export async function loader() {
  const integrations = await listIntegrations();

  return {
    integrations: integrations.map(integration => ({
      source: integration.source,
      intake: integration.intake,
      enabled: integration.enabled,
      isDraft: integration.dictionaryStatus === 'draft',
      missingFields: integration.bindings.filter(binding => binding.required && !binding.path)
        .length,
      uncovered: countUncovered(integration),
    })),
  };
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

export default function Integrations({ loaderData }: Route.ComponentProps) {
  const { integrations } = loaderData;

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title="Integrações"
        subtitle="Os sistemas que enviam eventos para cá."
        action={
          <GhostButton>
            <PlusIcon className="h-4 w-4" />
            Nova integração
          </GhostButton>
        }
      />

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
