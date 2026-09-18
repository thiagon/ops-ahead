import { Form, useNavigation } from 'react-router';
import { Badge, type BadgeTone } from '~/components/Badge';
import { GhostSubmit, inputClass, SubmitButton } from '~/components/form';
import { HistoryIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import {
  ConfigApiError,
  listDeadlines,
  listKpiTargets,
  listRevisions,
  replaceDeadlines,
  replaceKpiTargets,
  rollbackRevision,
} from '~/features/config/api.server.ts';
import { type ConfigDomain, formatDuration, SEVERITY_LABEL } from '~/features/config/types.ts';
import type { Route } from './+types/targets';

export function meta() {
  return [{ title: 'Metas e prazos · Ops Ahead' }];
}

export async function loader() {
  const [deadlines, kpiTargets, revisions] = await Promise.all([
    listDeadlines(),
    listKpiTargets(),
    listRevisions(),
  ]);
  return { deadlines, kpiTargets, revisions };
}

/**
 * Every deadline and band is submitted together: the API replaces the tenant's
 * whole set, so a partial form would silently drop the rows it left out.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();

  const revert = form.get('revert');
  if (typeof revert === 'string') {
    try {
      await rollbackRevision(revert);
    } catch (error) {
      if (error instanceof ConfigApiError) return { error: error.detail };
      throw error;
    }
    return { error: null };
  }

  const deadlines = form.getAll('severity').map((severity, index) => ({
    severity: Number(severity),
    deadlineSeconds: Number(form.getAll('deadlineSeconds')[index]),
  }));
  const kpiTargets = form.getAll('kpiGroup').map((kpiGroup, index) => ({
    kpiGroup: String(kpiGroup),
    maxBreaches: Number(form.getAll('maxBreaches')[index]),
    achievementPct: Number(form.getAll('achievementPct')[index]),
  }));

  try {
    await Promise.all([replaceDeadlines(deadlines), replaceKpiTargets(kpiTargets)]);
  } catch (error) {
    if (error instanceof ConfigApiError) return { error: error.detail };
    throw error;
  }

  return { error: null };
}

const DOMAIN_LABEL: Record<ConfigDomain, string> = {
  origin: 'Integração',
  dictionary: 'Dicionário',
  deadline: 'Prazo',
  kpi_target: 'Meta',
};

function achievementTone(pct: number): BadgeTone {
  if (pct >= 100) return 'green';
  if (pct >= 50) return 'amber';
  return 'red';
}

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Targets({ loaderData, actionData }: Route.ComponentProps) {
  const { deadlines, kpiTargets, revisions } = loaderData;
  const groups = [...new Set(kpiTargets.map(target => target.kpiGroup))];
  const saving = useNavigation().state === 'submitting';

  return (
    <main className="p-6 sm:p-8">
      <Form method="post">
        <PageHeader
          title="Metas e prazos"
          subtitle="O contrato de atendimento. Vale para todas as integrações."
          action={<SubmitButton pending={saving}>Publicar alterações</SubmitButton>}
        />

        {actionData?.error && (
          <p className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-accent-red text-sm">
            {actionData.error}
          </p>
        )}

        <Panel title="Prazos de OLA" className="mb-6">
          <div className="flex flex-col gap-2">
            {deadlines.map(deadline => (
              <div
                key={deadline.severity}
                className="flex flex-col gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 sm:flex-row sm:items-center"
              >
                <span className="w-40 shrink-0 font-medium text-sm text-text-light">
                  {SEVERITY_LABEL[deadline.severity] ?? `P${deadline.severity}`}
                </span>
                <input type="hidden" name="severity" value={deadline.severity} />
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="number"
                    name="deadlineSeconds"
                    min={0}
                    step={60}
                    defaultValue={deadline.deadlineSeconds}
                    aria-label={`Prazo em segundos para P${deadline.severity}`}
                    className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[180px]`}
                  />
                  <span className="text-text-dim text-xs">segundos</span>
                </div>
                <Badge tone="neutral">{formatDuration(deadline.deadlineSeconds)}</Badge>
              </div>
            ))}
          </div>
        </Panel>

        {groups.map(group => (
          <Panel
            key={group}
            title={`Meta — ${group === 'p1_p2' ? 'P1 + P2' : group.toUpperCase()}`}
            className="mb-4"
          >
            <div className="flex flex-col gap-2">
              {kpiTargets
                .filter(target => target.kpiGroup === group)
                .map(target => (
                  <div
                    key={`${group}:${target.achievementPct}`}
                    className="flex flex-col gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 sm:flex-row sm:items-center"
                  >
                    <input type="hidden" name="kpiGroup" value={group} />
                    <input type="hidden" name="achievementPct" value={target.achievementPct} />
                    <div className="flex w-36 shrink-0 items-center gap-2">
                      <span className="flex w-12 justify-end">
                        <Badge tone={achievementTone(target.achievementPct)}>
                          {target.achievementPct}%
                        </Badge>
                      </span>
                      <span className="text-text-dim text-xs">atingimento</span>
                    </div>
                    <div className="flex flex-1 items-center gap-2">
                      <span className="shrink-0 text-sm text-text-muted">até</span>
                      <input
                        type="number"
                        name="maxBreaches"
                        min={0}
                        defaultValue={target.maxBreaches}
                        aria-label={`Teto de violações para ${target.achievementPct}% em ${group}`}
                        className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[180px]`}
                      />
                      <span className="text-text-dim text-xs">violações no ano</span>
                    </div>
                  </div>
                ))}
            </div>
          </Panel>
        ))}
      </Form>

      <Panel className="mt-6">
        <div className="mb-4 flex items-center gap-2.5">
          <HistoryIcon className="h-5 w-5 text-text-muted" />
          <h2 className="font-semibold text-text-light text-xl">Histórico</h2>
        </div>
        <p className="mb-4 text-sm text-text-muted">
          Toda alteração publicada fica registrada e pode ser revertida.
        </p>

        <div className="flex flex-col">
          {revisions.map(revision => (
            <div
              key={revision.id}
              className="flex flex-col gap-2 border-border-base border-b py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Badge tone="neutral">{DOMAIN_LABEL[revision.domain]}</Badge>
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-light">{revision.summary}</p>
                  <p className="text-text-dim text-xs">
                    {revision.author} · {formatAt(revision.at)}
                  </p>
                </div>
              </div>
              <Form method="post">
                <GhostSubmit name="revert" value={revision.id}>
                  Reverter
                </GhostSubmit>
              </Form>
            </div>
          ))}
        </div>
      </Panel>
    </main>
  );
}
