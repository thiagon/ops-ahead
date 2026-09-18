import { useState } from 'react';
import { Form, useNavigation } from 'react-router';
import { Badge, type BadgeTone } from '~/components/Badge';
import { GhostButton, inputClass, SubmitButton } from '~/components/form';
import { PlusIcon, TrashIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import { dashedAddClass, iconButtonClass, nextDraftId } from '~/features/config/editor-ui.ts';
import { HistoryPanel, type HistoryRevision } from '~/features/config/HistoryPanel.tsx';
import {
  ConflictError,
  listKpiTargets,
  listRevisions,
  NotFoundError,
  replaceKpiTargets,
  withTenant,
} from '~/features/config/repo.server.ts';
import {
  formatKpiGroup,
  KNOWN_SEVERITIES,
  type KpiTarget,
  kpiGroupKey,
  severityLabel,
} from '~/features/config/types.ts';
import type { Route } from './+types/targets';

export function meta() {
  return [{ title: 'Metas · Ops Ahead' }];
}

export async function loader({ params }: Route.LoaderArgs) {
  return withTenant(params.tenant, async () => {
    const [kpiTargets, revisions] = await Promise.all([
      listKpiTargets(),
      listRevisions(['kpi_target']),
    ]);
    return { kpiTargets, revisions };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  return withTenant(params.tenant, async () => {
    const form = await request.formData();
    const kpiTargets = parseKpiTargets(form);
    if (typeof kpiTargets === 'string') return { error: kpiTargets };

    try {
      await replaceKpiTargets(kpiTargets);
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError)
        return { error: error.message };
      throw error;
    }

    return { error: null };
  });
}

function parseKpiTargets(form: FormData): KpiTarget[] | string {
  const kpiTargets = form.getAll('severities').map((severities, index) => ({
    severities: String(severities)
      .split(',')
      .map(Number)
      .filter(severity => Number.isInteger(severity) && severity > 0),
    maxBreaches: Number(form.getAll('maxBreaches')[index]),
    achievementPct: Number(form.getAll('achievementPct')[index]),
  }));
  if (kpiTargets.some(target => target.severities.length === 0)) {
    return 'Cada meta precisa de pelo menos uma prioridade.';
  }
  if (
    kpiTargets.some(
      target =>
        !Number.isInteger(target.maxBreaches) ||
        target.maxBreaches < 0 ||
        !Number.isFinite(target.achievementPct) ||
        target.achievementPct < 0,
    )
  ) {
    return 'Cada faixa precisa de um percentual e um teto de violações.';
  }
  const keys = kpiTargets.map(
    target => `${kpiGroupKey(target.severities)}:${target.achievementPct}`,
  );
  if (new Set(keys).size !== keys.length) {
    return 'Não pode haver duas faixas iguais no mesmo grupo.';
  }
  return kpiTargets;
}

function achievementTone(pct: number): BadgeTone {
  if (pct >= 100) return 'green';
  if (pct >= 50) return 'amber';
  return 'red';
}

type BandDraft = { id: string; achievementPct: number; maxBreaches: number };
type GroupDraft = { id: string; severities: number[]; bands: BandDraft[] };

function toGroupDrafts(targets: readonly KpiTarget[]): GroupDraft[] {
  const groups = new Map<string, GroupDraft>();
  for (const target of targets) {
    const key = kpiGroupKey(target.severities);
    const band = {
      id: nextDraftId(),
      achievementPct: target.achievementPct,
      maxBreaches: target.maxBreaches,
    };
    const group = groups.get(key);
    if (group) group.bands.push(band);
    else groups.set(key, { id: nextDraftId(), severities: [...target.severities], bands: [band] });
  }
  return [...groups.values()];
}

function fromGroups(groups: readonly GroupDraft[]): KpiTarget[] {
  return groups.flatMap(group =>
    group.bands.map(band => ({
      severities: [...group.severities].sort((a, b) => a - b),
      achievementPct: band.achievementPct,
      maxBreaches: band.maxBreaches,
    })),
  );
}

function kpiFingerprint(targets: readonly KpiTarget[]): string {
  return JSON.stringify(
    targets
      .map(
        target =>
          `${kpiGroupKey(target.severities)}:${target.achievementPct}:${target.maxBreaches}`,
      )
      .sort(),
  );
}

function chipSeverities(selected: readonly number[]): number[] {
  return [...new Set([...KNOWN_SEVERITIES, ...selected])].sort((a, b) => a - b);
}

function firstUnused(used: readonly number[]): number | undefined {
  return KNOWN_SEVERITIES.find(severity => !used.includes(severity));
}

function SeverityChips({
  selected,
  onToggle,
}: {
  selected: readonly number[];
  onToggle: (severity: number) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {chipSeverities(selected).map(severity => {
        const on = selected.includes(severity);
        return (
          <button
            key={severity}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(severity)}
            className={`rounded-lg border px-2.5 py-1.5 font-medium text-sm transition-colors ${
              on
                ? 'border-signal-blue/50 bg-signal-blue/10 text-text-light'
                : 'border-border-base text-text-dim hover:border-signal-blue/40 hover:text-text-light'
            }`}
          >
            {severityLabel(severity)}
          </button>
        );
      })}
    </div>
  );
}

function MetasEditor({
  saved,
  initial,
  error,
  onReset,
}: {
  saved: KpiTarget[];
  initial: KpiTarget[];
  error: string | null | undefined;
  onReset: () => void;
}) {
  const saving = useNavigation().state === 'submitting';
  const [groups, setGroups] = useState(() => toGroupDrafts(initial));
  const dirty = kpiFingerprint(fromGroups(groups)) !== kpiFingerprint(saved);

  function toggleSeverity(id: string, severity: number) {
    setGroups(rows =>
      rows.map(row => {
        if (row.id !== id) return row;
        const on = row.severities.includes(severity);
        return {
          ...row,
          severities: on
            ? row.severities.filter(value => value !== severity)
            : [...row.severities, severity].sort((a, b) => a - b),
        };
      }),
    );
  }

  function updateBand(groupId: string, bandId: string, patch: Partial<Omit<BandDraft, 'id'>>) {
    setGroups(rows =>
      rows.map(row =>
        row.id === groupId
          ? {
              ...row,
              bands: row.bands.map(band => (band.id === bandId ? { ...band, ...patch } : band)),
            }
          : row,
      ),
    );
  }

  function addBand(groupId: string) {
    setGroups(rows =>
      rows.map(row =>
        row.id === groupId
          ? {
              ...row,
              bands: [...row.bands, { id: nextDraftId(), achievementPct: 100, maxBreaches: 0 }],
            }
          : row,
      ),
    );
  }

  function addGroup() {
    const unused = firstUnused(groups.flatMap(group => group.severities));
    setGroups(rows => [
      ...rows,
      {
        id: nextDraftId(),
        severities: unused == null ? [] : [unused],
        bands: [{ id: nextDraftId(), achievementPct: 100, maxBreaches: 0 }],
      },
    ]);
  }

  return (
    <Form method="post">
      <PageHeader
        title="Metas"
        subtitle="Teto anual de violações. Vale para todas as origens."
        action={
          <>
            <GhostButton disabled={!dirty || saving} onClick={onReset}>
              Descartar alterações
            </GhostButton>
            <SubmitButton pending={saving} disabled={!dirty}>
              Publicar alterações
            </SubmitButton>
          </>
        }
      />

      {error && (
        <p className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-accent-red text-sm">
          {error}
        </p>
      )}

      {groups.map(group => (
        <Panel
          key={group.id}
          title={group.severities.length ? formatKpiGroup(group.severities) : 'Meta'}
          className="mb-4"
          action={
            <GhostButton
              tone="danger"
              onClick={() => setGroups(rows => rows.filter(row => row.id !== group.id))}
            >
              Remover grupo
            </GhostButton>
          }
        >
          <p className="mb-3 text-sm text-text-muted">
            Prioridades que compartilham o teto anual. Cada faixa é um percentual de atingimento.
          </p>
          <SeverityChips
            selected={group.severities}
            onToggle={severity => toggleSeverity(group.id, severity)}
          />
          <div className="flex flex-col gap-2">
            {group.bands.map(band => (
              <div
                key={band.id}
                className="flex flex-col gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 sm:flex-row sm:items-center"
              >
                <input type="hidden" name="severities" value={kpiGroupKey(group.severities)} />
                <div className="flex w-48 shrink-0 items-center gap-2">
                  <input
                    type="number"
                    name="achievementPct"
                    min={0}
                    step={0.01}
                    value={band.achievementPct}
                    onChange={event =>
                      updateBand(group.id, band.id, { achievementPct: Number(event.target.value) })
                    }
                    aria-label={`Percentual de atingimento em ${formatKpiGroup(group.severities) || 'este grupo'}`}
                    className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[96px]`}
                  />
                  <Badge tone={achievementTone(band.achievementPct)}>%</Badge>
                  <span className="text-text-dim text-xs">atingimento</span>
                </div>
                <div className="flex flex-1 items-center gap-2">
                  <span className="shrink-0 text-sm text-text-muted">até</span>
                  <input
                    type="number"
                    name="maxBreaches"
                    min={0}
                    value={band.maxBreaches}
                    onChange={event =>
                      updateBand(group.id, band.id, { maxBreaches: Number(event.target.value) })
                    }
                    aria-label={`Teto de violações para ${band.achievementPct}% em ${formatKpiGroup(group.severities) || 'este grupo'}`}
                    className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[180px]`}
                  />
                  <span className="text-text-dim text-xs">violações no ano</span>
                </div>
                <button
                  type="button"
                  aria-label="Remover faixa"
                  onClick={() =>
                    setGroups(rows =>
                      rows.map(row =>
                        row.id === group.id
                          ? { ...row, bands: row.bands.filter(item => item.id !== band.id) }
                          : row,
                      ),
                    )
                  }
                  className={iconButtonClass(true)}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addBand(group.id)} className={dashedAddClass()}>
              <PlusIcon className="h-3.5 w-3.5 shrink-0" />
              Adicionar faixa
            </button>
          </div>
        </Panel>
      ))}

      <button type="button" onClick={addGroup} className={`${dashedAddClass()} mb-2 w-full`}>
        <PlusIcon className="h-3.5 w-3.5 shrink-0" />
        Adicionar grupo de meta
      </button>
    </Form>
  );
}

export default function Metas({ loaderData, actionData }: Route.ComponentProps) {
  const { kpiTargets, revisions } = loaderData;
  return (
    <MetasDraft
      key={kpiFingerprint(kpiTargets)}
      saved={kpiTargets}
      revisions={revisions}
      error={actionData?.error}
    />
  );
}

function MetasDraft({
  saved,
  revisions,
  error,
}: {
  saved: KpiTarget[];
  revisions: readonly HistoryRevision[];
  error: string | null | undefined;
}) {
  const [preview, setPreview] = useState<{ nonce: number; targets: KpiTarget[] } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  return (
    <main className="p-6 sm:p-8">
      <MetasEditor
        key={preview ? String(preview.nonce) : `saved-${resetNonce}`}
        saved={saved}
        initial={preview?.targets ?? saved}
        error={error}
        onReset={() => {
          setPreview(null);
          setResetNonce(nonce => nonce + 1);
        }}
      />
      <HistoryPanel
        revisions={revisions}
        onRestore={payload => {
          if (Array.isArray(payload)) {
            setPreview({ nonce: Date.now(), targets: payload as KpiTarget[] });
          }
        }}
      />
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Metas" service="O serviço de configuração" />;
}
