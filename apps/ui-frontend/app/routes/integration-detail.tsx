import { useState } from 'react';
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
  useNavigation,
  useSearchParams,
} from 'react-router';
import { Badge } from '~/components/Badge';
import {
  Field,
  GhostButton,
  GhostSubmit,
  InputButton,
  inputClass,
  SubmitButton,
} from '~/components/form';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshIcon,
  SendIcon,
  TrashIcon,
} from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import { getConfig } from '~/config.server.ts';
import {
  ConflictError,
  currentTenant,
  getIntegration,
  NotFoundError,
  removeMapping,
  rotateSecret,
  setOriginStatus,
  updateBindings,
  upsertMapping,
  withTenant,
} from '~/features/config/repo.server.ts';
import { parseIntegrationTab, samplePayload } from '~/features/config/sample-payload.ts';
import { takeSecretFlash } from '~/features/config/secret-flash.server.ts';
import {
  CONTRACT_FIELDS,
  DOMAIN_VALUES,
  FIELD_HINT,
  INTAKE_LABEL,
  type MappingEntry,
  type MappingField,
  SEVERITY_VALUE_LABEL,
  type Status,
  webhookUrl,
} from '~/features/config/types.ts';
import {
  postToWebhook,
  unreachableWebhookMessage,
  validateWebhookBody,
} from '~/features/config/webhook-post.server.ts';
import { integrationsPath, useTenantSlug } from '~/paths';
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

export async function loader({ params, request }: Route.LoaderArgs) {
  return withTenant(params.tenant, async () => {
    const integration = await getIntegration(params.source).catch(error => {
      if (error instanceof NotFoundError) {
        throw new Response('Integração não encontrada', { status: 404 });
      }
      throw error;
    });

    const config = getConfig();
    const tenant = await currentTenant();
    // The contract decides which fields exist and which of them translate; the
    // integration only says where each one is read.
    const bound = new Map(integration.bindings.map(binding => [binding.field, binding.path]));
    const fields = CONTRACT_FIELDS[integration.intake].map(contract => {
      const path = bound.get(contract.field) ?? null;
      if (!contract.translated) return { ...contract, path, values: null };
      const field = contract.field as MappingField;
      return {
        ...contract,
        path,
        values: {
          freeForm: DOMAIN_VALUES[field].length === 0,
          rows: buildRows(field, integration.mappings[field] ?? []),
        },
      };
    });

    const { secret, clearHeader } = await takeSecretFlash(request, params.source);
    const headers = clearHeader ? { 'Set-Cookie': clearHeader } : undefined;

    return data(
      {
        origin: integration,
        url: webhookUrl(
          config.PUBLIC_GATEWAY_URL,
          integration.envelopeVersion,
          tenant.slug,
          integration.source,
        ),
        fields,
        sampleBody: JSON.stringify(samplePayload(fields), null, 2),
        dictionaryVersion: integration.dictionaryVersion,
        dictionaryStatus: integration.dictionaryStatus,
        flashedSecret: secret,
      },
      { headers },
    );
  });
}

type ActionResult = {
  secret: string | null;
  error: string | null;
  test: { status: number; ok: boolean; body: string } | null;
};

function ok(partial: Partial<ActionResult> = {}): ActionResult {
  return { secret: null, error: null, test: null, ...partial };
}

/**
 * Every write of this screen lands here, discriminated by `intent`. Saving the
 * paths navigates; adding or removing one mapped value does not, so those are
 * submitted with a fetcher and answer with the value alone.
 */
export async function action({ params, request }: Route.ActionArgs) {
  return withTenant(params.tenant, async () => {
    const form = await request.formData();
    const intent = form.get('intent');

    try {
      if (intent === 'rotate-secret') {
        return ok({ secret: await rotateSecret(params.source) });
      }

      if (intent === 'set-status') {
        const status = String(form.get('status'));
        if (status !== 'active' && status !== 'inactive' && status !== 'archived') {
          return ok({ error: 'Estado inválido.' });
        }
        await setOriginStatus(params.source, status);
        if (status === 'archived') return redirect(integrationsPath(params.tenant));
        return ok();
      }

      if (intent === 'add-mapping') {
        await upsertMapping(params.source, {
          field: form.get('field') as MappingField,
          from: String(form.get('from') ?? '').trim(),
          to: String(form.get('to') ?? ''),
        });
        return ok();
      }

      if (intent === 'remove-mapping') {
        await removeMapping(params.source, Number(form.get('mappingId')));
        return ok();
      }

      if (intent === 'test-post') {
        const body = String(form.get('body') ?? '');
        const problem = validateWebhookBody(body);
        if (problem) return ok({ error: problem });

        const config = getConfig();
        const tenant = await currentTenant();
        const integration = await getIntegration(params.source);
        const url = webhookUrl(
          config.PUBLIC_GATEWAY_URL,
          integration.envelopeVersion,
          tenant.slug,
          integration.source,
        );

        try {
          return ok({
            test: await postToWebhook(url, body, String(form.get('secret') ?? '').trim()),
          });
        } catch (error) {
          return ok({ error: unreachableWebhookMessage(error) });
        }
      }

      const bindings = form.getAll('field').map((field, index) => ({
        field: String(field),
        path: String(form.getAll('path')[index] ?? '').trim() || null,
      }));
      await updateBindings(params.source, bindings);
      return ok();
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError) {
        return ok({ error: error.message });
      }
      throw error;
    }
  });
}

type FieldRow = Route.ComponentProps['loaderData']['fields'][number];

const textareaClass =
  'min-h-64 w-full resize-y rounded-lg border border-border-base bg-bg-elevated px-3 py-2.5 font-mono text-xs text-text-light outline-none transition-colors placeholder:text-text-dim focus:border-signal-blue/60';

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
  const fetcher = useFetcher();
  if (fetcher.state !== 'idle') return null;

  return (
    <span className="flex h-8 items-center gap-1.5 rounded-lg border border-border-base bg-bg-tile pl-2.5 text-sm text-text-light">
      {entry.from}
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="remove-mapping" />
        <input type="hidden" name="mappingId" value={entry.id} />
        <button
          type="submit"
          aria-label={`Remover ${entry.from}`}
          className="flex h-8 w-7 items-center justify-center rounded-r-lg text-text-dim transition-colors hover:bg-accent-red/10 hover:text-accent-red"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </fetcher.Form>
    </span>
  );
}

function ValueRow({ field, row }: { field: string; row: DomainRow }) {
  const [adding, setAdding] = useState(false);
  const fetcher = useFetcher();
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
        {adding ? (
          <fetcher.Form
            method="post"
            className="flex items-center gap-2"
            onSubmit={() => setAdding(false)}
          >
            <input type="hidden" name="intent" value="add-mapping" />
            <input type="hidden" name="field" value={field} />
            <input type="hidden" name="to" value={row.domainValue} />
            <input
              name="from"
              required
              placeholder={`Valor enviado como ${label ?? row.domainValue}`}
              aria-label={`Valor da origem para ${row.domainValue}`}
              className={`${inputClass} h-8 w-64 bg-bg-tile text-xs`}
            />
            <GhostSubmit>Adicionar</GhostSubmit>
          </fetcher.Form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-8 items-center gap-1.5 rounded-lg border border-border-base border-dashed px-2.5 py-1.5 text-left text-sm text-text-dim transition-colors hover:border-signal-blue/50 hover:text-text-light"
          >
            <PlusIcon className="h-3.5 w-3.5 shrink-0" />
            {empty ? `Qual valor chega como ${label ?? row.domainValue}?` : 'Adicionar'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A free-form target has no list to fill in, so both sides are typed: what the
 * origin sends and what we call it.
 */
function FreeFormRow({ field }: { field: string }) {
  const fetcher = useFetcher();

  return (
    <fetcher.Form method="post" className="flex flex-wrap items-center gap-2 pt-3">
      <input type="hidden" name="intent" value="add-mapping" />
      <input type="hidden" name="field" value={field} />
      <input
        name="from"
        required
        placeholder="Valor enviado pela origem"
        aria-label="Valor enviado pela origem"
        className={`${inputClass} h-8 w-56 bg-bg-tile text-xs`}
      />
      <span className="text-text-dim">→</span>
      <input
        name="to"
        required
        placeholder="Como chamamos"
        aria-label="Valor correspondente do domínio"
        className={`${inputClass} h-8 w-56 bg-bg-tile text-xs`}
      />
      <GhostSubmit>
        <PlusIcon className="h-4 w-4" />
        Adicionar desfecho
      </GhostSubmit>
    </fetcher.Form>
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
          <input type="hidden" form="bindings" name="field" value={row.field} />
          <input
            form="bindings"
            name="path"
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
          {values.freeForm && <FreeFormRow field={row.field} />}
        </div>
      )}
    </div>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      preventScrollReset
      replace
      role="tab"
      aria-selected={active}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors ${
        active
          ? 'border-accent-red text-text-light'
          : 'border-transparent text-text-muted hover:text-text-light'
      }`}
    >
      {children}
    </Link>
  );
}

function statusHint(lifecycle: Status, canActivate: boolean): string {
  if (lifecycle === 'active') return 'Recebe eventos neste endereço.';
  if (canActivate) return 'Desligada. Ative para voltar a receber.';
  return 'Só ativa quando o dicionário está completo.';
}

function StatusField({ lifecycle, canActivate }: { lifecycle: Status; canActivate: boolean }) {
  const [confirmArchive, setConfirmArchive] = useState(false);

  return (
    <Field id="lifecycle" label="Estado" hint={statusHint(lifecycle, canActivate)}>
      {() =>
        confirmArchive ? (
          <Form method="post" className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="intent" value="set-status" />
            <input type="hidden" name="status" value="archived" />
            <Badge tone="neutral">{lifecycle === 'active' ? 'Ativa' : 'Inativa'}</Badge>
            <p className="text-sm text-text-muted">Sai da lista de entrada.</p>
            <div className="flex gap-2">
              <GhostSubmit tone="danger">Confirmar</GhostSubmit>
              <InputButton type="button" onClick={() => setConfirmArchive(false)}>
                Cancelar
              </InputButton>
            </div>
          </Form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={lifecycle === 'active' ? 'green' : 'neutral'}>
              {lifecycle === 'active' ? 'Ativa' : 'Inativa'}
            </Badge>
            {lifecycle === 'active' ? (
              <Form method="post">
                <input type="hidden" name="intent" value="set-status" />
                <input type="hidden" name="status" value="inactive" />
                <GhostSubmit>Inativar</GhostSubmit>
              </Form>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="set-status" />
                <input type="hidden" name="status" value="active" />
                <GhostSubmit disabled={!canActivate}>Ativar</GhostSubmit>
              </Form>
            )}
            <GhostButton tone="danger" onClick={() => setConfirmArchive(true)}>
              Arquivar
            </GhostButton>
          </div>
        )
      }
    </Field>
  );
}

function BasicTab({
  source,
  url,
  secret,
  lifecycle,
  canActivate,
}: {
  source: string;
  url: string;
  secret: string | null;
  lifecycle: Status;
  canActivate: boolean;
}) {
  const [confirmRotate, setConfirmRotate] = useState(false);

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <CopyField
          label="Nome"
          value={source}
          hint="Definido na criação. Aparece no endereço de envio."
        />
        <StatusField lifecycle={lifecycle} canActivate={canActivate} />
        <CopyField
          label="Endereço de envio"
          value={url}
          hint="Cada envio é um POST com o corpo em JSON."
        />

        {secret ? (
          <CopyField
            label="Chave de assinatura"
            value={secret}
            hint="Guarde agora — ao sair desta tela ela não é mais exibida."
          />
        ) : (
          <Field
            id="secret"
            label="Chave de assinatura"
            hint="Assine o corpo com HMAC SHA-256 e envie no cabeçalho X-Signature."
          >
            {id =>
              confirmRotate ? (
                <Form method="post" className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input type="hidden" name="intent" value="rotate-secret" />
                  <input
                    id={id}
                    readOnly
                    value="••••••••••••••••••••••••••••••••"
                    className={`${inputClass} font-mono text-text-dim text-xs`}
                  />
                  <p className="shrink-0 text-sm text-text-muted sm:max-w-xs">
                    A chave atual deixa de valer. Atualize no {source} em seguida.
                  </p>
                  <div className="flex gap-2">
                    <InputButton type="submit">
                      <RefreshIcon className="h-4 w-4 shrink-0" />
                      Confirmar
                    </InputButton>
                    <InputButton type="button" onClick={() => setConfirmRotate(false)}>
                      Cancelar
                    </InputButton>
                  </div>
                </Form>
              ) : (
                <div className="flex gap-2">
                  <input
                    id={id}
                    readOnly
                    value="••••••••••••••••••••••••••••••••"
                    className={`${inputClass} font-mono text-text-dim text-xs`}
                  />
                  <InputButton type="button" onClick={() => setConfirmRotate(true)}>
                    <RefreshIcon className="h-4 w-4 shrink-0" />
                    Gerar
                  </InputButton>
                </div>
              )
            }
          </Field>
        )}
        <p className="-mt-1 text-text-dim text-xs">
          A chave aparece uma única vez, no momento em que é gerada. Se ela se perder, gere outra e
          atualize no {source}.
        </p>
      </div>
    </Panel>
  );
}

function DictionaryTab({
  fields,
  missing,
  uncovered,
  dictionaryVersion,
  dictionaryStatus,
}: {
  fields: FieldRow[];
  missing: number;
  uncovered: number;
  dictionaryVersion: string | null;
  dictionaryStatus: string | null;
}) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2.5">
        {missing > 0 && <Badge tone="red">{missing} OBRIGATÓRIOS EM FALTA</Badge>}
        {uncovered > 0 && <Badge tone="amber">{uncovered} VALORES SEM MAPEAMENTO</Badge>}
        {missing === 0 && uncovered === 0 && <Badge tone="green">COMPLETO</Badge>}
        {dictionaryVersion && (
          <Badge tone="neutral">
            {dictionaryVersion.toUpperCase()}
            {dictionaryStatus === 'inactive' ? ' · RASCUNHO' : ''}
          </Badge>
        )}
      </div>
      <p className="mb-4 text-sm text-text-muted">
        Onde encontrar cada campo no JSON enviado. Use ponto para aninhados. Campos com valores
        fixos expandem para a tradução.
      </p>

      {/* The rows carry a fetcher form each, so the paths form stays empty and
          its inputs join it by id — a form cannot contain another. */}
      <Form method="post" id="bindings" />
      <div className="flex flex-col gap-2">
        {fields.map(row => (
          <FieldRowItem key={row.field} row={row} />
        ))}
      </div>
    </>
  );
}

function formatTestBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function TestTab({
  fields,
  sampleBody,
  secret,
}: {
  fields: FieldRow[];
  sampleBody: string;
  secret: string | null;
}) {
  const fetcher = useFetcher<ActionResult>();
  const [body, setBody] = useState(sampleBody);
  const pending = fetcher.state !== 'idle';
  const result = fetcher.data;

  return (
    <Panel>
      <p className="mb-5 text-sm text-text-muted">
        Envia um POST para o mesmo endereço da aba Envio, como o sistema de origem faria.
      </p>

      <fetcher.Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="test-post" />
        <Field id="test-body" label="Corpo" hint="Objeto JSON. O envio usa exatamente estes bytes.">
          {id => (
            <textarea
              id={id}
              name="body"
              value={body}
              onChange={event => setBody(event.target.value)}
              spellCheck={false}
              className={textareaClass}
            />
          )}
        </Field>

        <Field
          id="test-secret"
          label="Chave de assinatura"
          hint="Cole a chave gerada na aba Envio se o gateway exigir assinatura."
        >
          {id => (
            <input
              id={id}
              name="secret"
              type={secret ? 'text' : 'password'}
              autoComplete="off"
              defaultValue={secret ?? ''}
              placeholder="opcional em desenvolvimento"
              className={`${inputClass} font-mono text-xs`}
            />
          )}
        </Field>

        {result?.error && (
          <p className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-accent-red text-sm">
            {result.error}
          </p>
        )}

        {result?.test && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              result.test.ok
                ? 'border-signal-green/40 bg-signal-green/10 text-signal-green'
                : 'border-accent-red/40 bg-accent-red/10 text-accent-red'
            }`}
          >
            <p className="font-medium">
              {result.test.ok ? 'Aceito' : 'Recusado'} · HTTP {result.test.status}
            </p>
            {result.test.body && (
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs text-text-light">
                {formatTestBody(result.test.body)}
              </pre>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <SubmitButton pending={pending} pendingLabel="Enviando…">
            <SendIcon className="h-4 w-4" />
            Enviar POST
          </SubmitButton>
          <GhostButton
            onClick={() => setBody(JSON.stringify(samplePayload(fields), null, 2))}
            disabled={pending}
          >
            Preencher de novo
          </GhostButton>
        </div>
      </fetcher.Form>
    </Panel>
  );
}

export default function IntegrationDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { origin, url, fields, sampleBody, dictionaryVersion, dictionaryStatus, flashedSecret } =
    loaderData;
  const tenant = useTenantSlug();
  const saving = useNavigation().state === 'submitting';
  const [searchParams] = useSearchParams();
  const tab = parseIntegrationTab(searchParams.get('tab'));
  const secret = actionData?.secret ?? flashedSecret;
  const missing = fields.filter(row => row.required && !row.path).length;
  const uncovered = fields.reduce((total, row) => {
    if (!row.values || row.values.freeForm) return total;
    return total + row.values.rows.filter(entry => entry.origins.length === 0).length;
  }, 0);

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title={origin.source}
        subtitle={`${INTAKE_LABEL[origin.intake]} · ${origin.lifecycle === 'active' ? 'Ativa' : 'Inativa'}`}
        breadcrumb={
          <Link
            to={integrationsPath(tenant)}
            className="flex items-center gap-1 text-sm text-text-muted hover:text-text-light"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Entrada
          </Link>
        }
        action={
          tab === 'dictionary' ? (
            <SubmitButton pending={saving} form="bindings">
              Publicar
            </SubmitButton>
          ) : undefined
        }
      />

      {actionData?.error && tab !== 'test' && (
        <p className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-accent-red text-sm">
          {actionData.error}
        </p>
      )}

      <nav
        aria-label="Seções da integração"
        className="mb-6 flex gap-1 border-border-base border-b"
      >
        <TabLink to="?tab=basic" active={tab === 'basic'}>
          Envio
        </TabLink>
        <TabLink to="?tab=dictionary" active={tab === 'dictionary'}>
          Dicionário
          {(missing > 0 || uncovered > 0) && (
            <Badge tone={missing > 0 ? 'red' : 'amber'}>{missing + uncovered}</Badge>
          )}
        </TabLink>
        <TabLink to="?tab=test" active={tab === 'test'}>
          Teste
        </TabLink>
      </nav>

      <div hidden={tab !== 'basic'} role="tabpanel">
        <BasicTab
          source={origin.source}
          url={url}
          secret={secret}
          lifecycle={origin.lifecycle}
          canActivate={missing === 0 && uncovered === 0}
        />
      </div>
      <div hidden={tab !== 'dictionary'} role="tabpanel">
        <DictionaryTab
          fields={fields}
          missing={missing}
          uncovered={uncovered}
          dictionaryVersion={dictionaryVersion}
          dictionaryStatus={dictionaryStatus}
        />
      </div>
      <div hidden={tab !== 'test'} role="tabpanel">
        <TestTab fields={fields} sampleBody={sampleBody} secret={secret} />
      </div>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Integração" service="O serviço de configuração" />;
}
