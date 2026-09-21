import { useEffect, useState } from 'react';
import { Form, useNavigation, useRevalidator } from 'react-router';
import { Badge, type BadgeTone } from '~/components/Badge';
import { Field, inputClass, SubmitButton } from '~/components/form';
import { RefreshIcon } from '~/components/icons';
import { LoadingScreen } from '~/components/LoadingScreen';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import { buildAnalysisRequest } from '~/features/analyses/payload.ts';
import { analysesRepo } from '~/features/analyses/repo.client.ts';
import { startAnalysis, withTenant } from '~/features/analyses/repo.server.ts';
import {
  ANALYSES,
  ANALYSIS_HINT,
  ANALYSIS_LABEL,
  type Analysis,
  type AnalysisRun,
  type AnalysisStatusValue,
  type AnalysisTrigger,
  isAnalysis,
  needsSplitDates,
  STATUS_LABEL,
  TRIGGER_LABEL,
} from '~/features/analyses/types.ts';
import type { Route } from './+types/analyses';

export function meta() {
  return [{ title: 'Análises · Ops Ahead' }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const tenant = params.tenant;
  if (!tenant) throw new Response('Tenant ausente', { status: 400 });
  return { runs: await analysesRepo(tenant).list() };
}

export function HydrateFallback() {
  return <LoadingScreen title="Análises" />;
}

export async function action({ request, params }: Route.ActionArgs) {
  return withTenant(request, params.tenant, async () => {
    const tenant = params.tenant;
    if (!tenant) return { error: 'Tenant ausente.', startedId: null as string | null };

    const form = await request.formData();
    const body = buildAnalysisRequest(tenant, {
      analysis: String(form.get('analysis') ?? ''),
      train_end: String(form.get('train_end') ?? ''),
      validation_end: String(form.get('validation_end') ?? ''),
      holdout_end: String(form.get('holdout_end') ?? ''),
      n_simulations: String(form.get('n_simulations') ?? ''),
      seed: String(form.get('seed') ?? ''),
      contamination: String(form.get('contamination') ?? ''),
      window_days: String(form.get('window_days') ?? ''),
    });
    if (typeof body === 'string') return { error: body, startedId: null as string | null };

    try {
      const { id } = await startAnalysis(body);
      return { error: null, startedId: id };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível iniciar a análise.';
      return { error: message, startedId: null as string | null };
    }
  });
}

function statusTone(status: AnalysisStatusValue): BadgeTone {
  switch (status) {
    case 'succeeded':
      return 'green';
    case 'failed':
      return 'red';
    case 'running':
      return 'blue';
    default:
      return 'amber';
  }
}

function analysisLabel(analysis: string | undefined): string {
  if (!analysis) return '—';
  if (isAnalysis(analysis)) return ANALYSIS_LABEL[analysis];
  return analysis;
}

function triggerLabel(trigger: AnalysisTrigger | undefined): string {
  return trigger ? TRIGGER_LABEL[trigger] : '—';
}

function formatWhen(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function AnalysisForm({ error }: { error: string | null | undefined }) {
  const saving = useNavigation().state === 'submitting';
  const [analysis, setAnalysis] = useState<Analysis>('full_pipeline');

  return (
    <Panel title="Nova análise">
      <Form method="post" className="flex flex-col gap-5">
        <Field id="analysis" label="Análise" hint={ANALYSIS_HINT[analysis]}>
          {id => (
            <select
              id={id}
              name="analysis"
              value={analysis}
              onChange={event => setAnalysis(event.target.value as Analysis)}
              className={inputClass}
            >
              {ANALYSES.map(value => (
                <option key={value} value={value}>
                  {ANALYSIS_LABEL[value]}
                </option>
              ))}
            </select>
          )}
        </Field>

        {needsSplitDates(analysis) && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="train_end"
              label="Fim do treino"
              hint="Último dia incluído no conjunto de treino."
            >
              {id => <input id={id} name="train_end" type="date" required className={inputClass} />}
            </Field>
            <Field
              id="validation_end"
              label="Fim da validação"
              hint="Depois do treino, antes do holdout."
            >
              {id => (
                <input id={id} name="validation_end" type="date" required className={inputClass} />
              )}
            </Field>
            <Field id="holdout_end" label="Fim do holdout" hint="Último dia do recorte.">
              {id => (
                <input id={id} name="holdout_end" type="date" required className={inputClass} />
              )}
            </Field>
          </div>
        )}

        {analysis === 'kpi_projection' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="n_simulations" label="Simulações" hint="Opcional.">
              {id => (
                <input
                  id={id}
                  name="n_simulations"
                  type="number"
                  min={1}
                  step={1}
                  placeholder="padrão do modelo"
                  className={inputClass}
                />
              )}
            </Field>
            <Field id="seed" label="Semente" hint="Opcional — reproduz a mesma simulação.">
              {id => <input id={id} name="seed" type="number" step={1} className={inputClass} />}
            </Field>
          </div>
        )}

        {analysis === 'external_event_detection' && (
          <Field
            id="contamination"
            label="Contaminação"
            hint="Opcional — fração esperada de anomalias (0 a 0,5)."
          >
            {id => (
              <input
                id={id}
                name="contamination"
                type="number"
                min={0}
                max={0.5}
                step={0.01}
                className={inputClass}
              />
            )}
          </Field>
        )}

        {analysis === 'recurring_causes' && (
          <Field id="window_days" label="Janela (dias)" hint="Opcional — histórico a agrupar.">
            {id => (
              <input
                id={id}
                name="window_days"
                type="number"
                min={1}
                step={1}
                className={inputClass}
              />
            )}
          </Field>
        )}

        {error && <p className="text-accent-red text-sm">{error}</p>}

        <div>
          <SubmitButton pending={saving} pendingLabel="Enviando…">
            Disparar análise
          </SubmitButton>
        </div>
      </Form>
    </Panel>
  );
}

function RunsTable({ runs }: { runs: AnalysisRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border-base py-8 text-center">
        <p className="text-sm text-text-muted">Nenhuma análise registrada ainda.</p>
        <p className="mt-1 text-text-dim text-xs">Dispare a primeira acima.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border-base">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-bg-elevated text-text-muted text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3">Análise</th>
            <th className="px-4 py-3">Origem</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Início</th>
            <th className="px-4 py-3">Fim</th>
            <th className="px-4 py-3">Id</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id} className="border-border-base border-t">
              <td className="px-4 py-3 text-text-light">{analysisLabel(run.analysis)}</td>
              <td className="px-4 py-3 text-text-muted">{triggerLabel(run.trigger)}</td>
              <td className="px-4 py-3">
                <Badge tone={statusTone(run.status)}>{STATUS_LABEL[run.status]}</Badge>
              </td>
              <td className="px-4 py-3 text-text-muted">{formatWhen(run.started_at)}</td>
              <td className="px-4 py-3 text-text-muted">{formatWhen(run.finished_at)}</td>
              <td className="px-4 py-3 font-mono text-text-dim text-xs">{run.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Analyses({ loaderData, actionData }: Route.ComponentProps) {
  const { runs } = loaderData;
  const revalidator = useRevalidator();
  const hasLive = runs.some(run => run.status === 'pending' || run.status === 'running');

  useEffect(() => {
    if (!hasLive) return;
    const timer = window.setInterval(() => {
      if (revalidator.state === 'idle') revalidator.revalidate();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasLive, revalidator]);

  return (
    <main className="p-6 sm:p-8">
      <PageHeader
        title="Análises"
        subtitle="Dispare qualquer análise e acompanhe o status no gateway."
        action={
          <button
            type="button"
            onClick={() => revalidator.revalidate()}
            disabled={revalidator.state !== 'idle'}
            className="flex h-9 items-center gap-2 rounded-lg border border-border-base px-3 font-medium text-sm text-text-muted transition-colors hover:bg-white/[0.04] hover:text-text-light disabled:opacity-50"
          >
            <RefreshIcon className="h-4 w-4" />
            Atualizar
          </button>
        }
      />

      {actionData?.startedId && (
        <p className="mb-4 rounded-lg border border-signal-green/40 bg-signal-green/10 px-4 py-3 text-sm text-text-light">
          Análise enfileirada · <span className="font-mono text-xs">{actionData.startedId}</span>
        </p>
      )}

      <AnalysisForm error={actionData?.error} />

      <Panel title="Histórico recente" className="mt-6">
        <RunsTable runs={runs} />
      </Panel>
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Análises" service="O gateway" />;
}
