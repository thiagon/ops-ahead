import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '~/components/Badge';
import { Field, GhostButton, InputButton, inputClass, PrimaryButton } from '~/components/form';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { getConfig } from '~/config.server.ts';
import { ConfigApiError, getIntegration } from '~/features/config/api.server.ts';
import {
  DOMAIN_VALUES,
  FIELD_HINT,
  INTAKE_HINT,
  type MappingEntry,
  type MappingField,
  SEVERITY_VALUE_LABEL,
  webhookUrl,
} from '~/features/config/types.ts';
import type { Route } from './+types/integration-detail';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.source} · Integrações · Ops Ahead` }];
}

/**
 * A field with a fixed vocabulary lists every value the domain knows, mapped or
 * not, so a gap is visible here instead of surfacing later as an untranslated
 * event.
 */
export type DomainRow = {
  domainValue: string;
  /** Origin values that land on this domain value — many to one, never the reverse. */
  origins: MappingEntry[];
};

function buildRows(field: MappingField, entries: MappingEntry[]): DomainRow[] {
  const byDomainValue = new Map<string, MappingEntry[]>();

  for (const value of DOMAIN_VALUES[field]) byDomainValue.set(value, []);
  for (const entry of entries) {
    const bucket = byDomainValue.get(entry.to);
    if (bucket) bucket.push(entry);
    // resolution_code has a free-form target, so its values are whatever the
    // dictionary already carries rather than a fixed list.
    else byDomainValue.set(entry.to, [entry]);
  }

  return [...byDomainValue].map(([domainValue, origins]) => ({ domainValue, origins }));
}

export async function loader({ params }: Route.LoaderArgs) {
  const integration = await getIntegration(params.source).catch(error => {
    if (error instanceof ConfigApiError && error.status === 404) {
      throw new Response('Integração não encontrada', { status: 404 });
    }
    throw error;
  });

  const config = getConfig();
  const fields = integration.bindings.map(binding => {
    if (!binding.translated) return { ...binding, values: null };
    const field = binding.field as MappingField;
    return {
      ...binding,
      values: {
        freeForm: DOMAIN_VALUES[field].length === 0,
        rows: buildRows(field, integration.mappings[field] ?? []),
      },
    };
  });

  return {
    origin: integration,
    url: webhookUrl(
      config.PUBLIC_GATEWAY_URL,
      integration.envelopeVersion,
      config.TENANT_ID,
      integration.source,
    ),
    fields,
    dictionaryVersion: integration.dictionaryVersion,
    dictionaryStatus: integration.dictionaryStatus,
  };
}

type FieldRow = Route.ComponentProps['loaderData']['fields'][number];

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Field id={`copy-${label}`} label={label} hint={hint}>
      {id => (
        <div className="flex gap-2">
          <input
            id={id}
            readOnly
            value={value}
            className={`${inputClass} font-mono text-text-muted text-xs`}
          />
          <InputButton
            onClick={() => {
              navigator.clipboard?.writeText(value).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {
                  // A browser that refuses the clipboard still shows the value
                  // in the field, which stays selectable.
                },
              );
            }}
          >
            {copied ? 'Copiado' : 'Copiar'}
          </InputButton>
        </div>
      )}
    </Field>
  );
}

function OriginChip({ entry }: { entry: MappingEntry }) {
  return (
    <span className="flex h-8 items-center gap-1.5 rounded-lg border border-border-base bg-bg-tile pl-2.5 text-sm text-text-light">
      {entry.from}
      <button
        type="button"
        aria-label={`Remover ${entry.from}`}
        className="flex h-8 w-7 items-center justify-center rounded-r-lg text-text-dim transition-colors hover:bg-accent-red/10 hover:text-accent-red"
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function ValueRow({ field, row }: { field: string; row: DomainRow }) {
  const empty = row.origins.length === 0;
  const label = field === 'severity' ? SEVERITY_VALUE_LABEL[row.domainValue] : undefined;

  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-start">
      <div className="flex w-44 shrink-0 items-center gap-2 pt-1">
        <span className={`text-sm ${empty ? 'text-text-dim' : 'text-text-light'}`}>
          {label ?? <code>{row.domainValue}</code>}
        </span>
        {label && <code className="text-text-dim text-xs">{row.domainValue}</code>}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {row.origins.map(entry => (
          <OriginChip key={entry.id} entry={entry} />
        ))}
        <button
          type="button"
          className="flex min-h-8 items-center gap-1.5 rounded-lg border border-border-base border-dashed px-2.5 py-1.5 text-left text-sm text-text-dim transition-colors hover:border-signal-blue/50 hover:text-text-light"
        >
          <PlusIcon className="h-3.5 w-3.5 shrink-0" />
          {empty ? `Qual valor chega como ${label ?? row.domainValue}?` : 'Adicionar'}
        </button>
      </div>
    </div>
  );
}

function FieldRowItem({ row }: { row: FieldRow }) {
  const [open, setOpen] = useState(false);
  const values = row.values;
  const covered = values?.freeForm
    ? null
    : (values?.rows.filter(entry => entry.origins.length > 0).length ?? null);
  const total = values?.rows.length ?? 0;

  return (
    <div className="rounded-lg border border-border-base bg-bg-elevated">
      <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
        <div className="flex w-56 shrink-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <code className="font-medium text-sm text-text-light">{row.field}</code>
            {row.required && <Badge tone="red">OBRIGATÓRIO</Badge>}
          </div>
          <span className="text-text-dim text-xs">{row.hint}</span>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-text-dim">←</span>
          <input
            defaultValue={row.path ?? ''}
            placeholder={row.required ? 'obrigatório' : 'deixe vazio se não existir'}
            aria-label={`Caminho no payload para ${row.field}`}
            className={`${inputClass} border-transparent bg-bg-tile font-mono text-xs`}
          />
        </div>

        {values && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="flex h-10 shrink-0 items-center gap-2 rounded-lg px-2.5 text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-light"
          >
            {covered === null ? (
              <span className="text-text-dim text-xs">{total} valores</span>
            ) : (
              <Badge tone={covered === total ? 'green' : 'amber'}>
                {covered}/{total}
              </Badge>
            )}
            {open ? (
              <ChevronDownIcon className="h-4 w-4" />
            ) : (
              <ChevronRightIcon className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {values && open && (
        <div className="border-border-base border-t px-3 pb-3">
          <p className="py-2.5 text-text-dim text-xs">{FIELD_HINT[row.field as MappingField]}</p>
          <div className="flex flex-col divide-y divide-border-base/60">
            {values.rows.map(entry => (
              <ValueRow key={entry.domainValue} field={row.field} row={entry} />
            ))}
          </div>
          {values.freeForm && (
            <div className="pt-3">
              <GhostButton>
                <PlusIcon className="h-4 w-4" />
                Adicionar desfecho
              </GhostButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntegrationDetail({ loaderData }: Route.ComponentProps) {
  const { origin, url, fields, dictionaryVersion, dictionaryStatus } = loaderData;
  const missing = fields.filter(row => row.required && !row.path).length;
  const uncovered = fields.reduce((total, row) => {
    if (!row.values || row.values.freeForm) return total;
    return total + row.values.rows.filter(entry => entry.origins.length === 0).length;
  }, 0);

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title={origin.source}
        subtitle={INTAKE_HINT[origin.intake]}
        breadcrumb={
          <Link
            to="/integracoes"
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text-light"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Integrações
          </Link>
        }
        action={<PrimaryButton>Publicar</PrimaryButton>}
      />

      <Panel title="Envio" className="mb-6">
        <p className="mb-5 text-sm text-text-muted">
          Configure estes dois valores no {origin.source}.
        </p>

        <div className="flex flex-col gap-4">
          <CopyField
            label="Endereço de envio"
            value={url}
            hint="Cada envio é um POST com o corpo em JSON."
          />

          <Field
            id="secret"
            label="Chave de assinatura"
            hint="Assine o corpo com HMAC SHA-256 e envie no cabeçalho X-Signature."
          >
            {id => (
              <div className="flex gap-2">
                <input
                  id={id}
                  readOnly
                  value="••••••••••••••••••••••••••••••••"
                  className={`${inputClass} font-mono text-text-dim text-xs`}
                />
                <InputButton>
                  <RefreshIcon className="h-4 w-4 shrink-0" />
                  Gerar
                </InputButton>
              </div>
            )}
          </Field>
          <p className="-mt-1 text-text-dim text-xs">
            A chave aparece uma única vez, no momento em que é gerada. Se ela se perder, gere outra
            e atualize no {origin.source}.
          </p>
        </div>
      </Panel>

      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        <h2 className="font-bold text-text-light text-xl">Campos</h2>
        {missing > 0 && <Badge tone="red">{missing} OBRIGATÓRIOS EM FALTA</Badge>}
        {uncovered > 0 && <Badge tone="amber">{uncovered} VALORES SEM MAPEAMENTO</Badge>}
        {missing === 0 && uncovered === 0 && <Badge tone="green">COMPLETO</Badge>}
        {dictionaryVersion && (
          <Badge tone="neutral">
            {dictionaryVersion.toUpperCase()}
            {dictionaryStatus === 'draft' ? ' · RASCUNHO' : ''}
          </Badge>
        )}
      </div>
      <p className="mb-4 text-sm text-text-muted">
        Onde encontrar cada campo no JSON enviado. Use ponto para aninhados. Campos com valores
        fixos expandem para a tradução.
      </p>

      <div className="flex flex-col gap-2">
        {fields.map(row => (
          <FieldRowItem key={row.field} row={row} />
        ))}
      </div>
    </main>
  );
}
