import { useState } from 'react';
import { Form, useNavigation } from 'react-router';
import { Badge } from '~/components/Badge';
import { GhostButton, inputClass, SubmitButton } from '~/components/form';
import { PlusIcon, TrashIcon } from '~/components/icons';
import { PageHeader } from '~/components/PageHeader';
import { Panel } from '~/components/Panel';
import { RouteError } from '~/components/RouteError';
import { dashedAddClass, iconButtonClass, nextDraftId } from '~/features/config/editor-ui.ts';
import { HistoryPanel, type HistoryRevision } from '~/features/config/HistoryPanel.tsx';
import {
  ConflictError,
  listDeadlines,
  listRevisions,
  NotFoundError,
  replaceDeadlines,
  withTenant,
} from '~/features/config/repo.server.ts';
import {
  type Deadline,
  formatDuration,
  KNOWN_SEVERITIES,
  severityLabel,
} from '~/features/config/types.ts';
import type { Route } from './+types/deadlines';

export function meta() {
  return [{ title: 'Prazos · Ops Ahead' }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  return withTenant(request, params.tenant, async () => {
    const [deadlines, revisions] = await Promise.all([
      listDeadlines(),
      listRevisions(['deadline']),
    ]);
    return { deadlines, revisions };
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  return withTenant(request, params.tenant, async () => {
    const form = await request.formData();
    const deadlines = parseDeadlines(form);
    if (typeof deadlines === 'string') return { error: deadlines };

    try {
      await replaceDeadlines(deadlines);
    } catch (error) {
      if (error instanceof ConflictError || error instanceof NotFoundError)
        return { error: error.message };
      throw error;
    }

    return { error: null };
  });
}

function parseDeadlines(form: FormData): Deadline[] | string {
  const deadlines = form.getAll('severity').map((severity, index) => ({
    severity: Number(severity),
    deadlineSeconds: Number(form.getAll('deadlineSeconds')[index]),
  }));
  if (
    deadlines.some(
      deadline =>
        !Number.isInteger(deadline.severity) ||
        deadline.severity < 1 ||
        !Number.isFinite(deadline.deadlineSeconds) ||
        deadline.deadlineSeconds < 0,
    )
  ) {
    return 'Cada prazo precisa de uma prioridade e um tempo em segundos.';
  }
  if (new Set(deadlines.map(deadline => deadline.severity)).size !== deadlines.length) {
    return 'Cada prioridade só pode ter um prazo.';
  }
  return deadlines;
}

type DeadlineDraft = { id: string; severity: number; deadlineSeconds: number };

function toDeadlineDrafts(deadlines: readonly Deadline[]): DeadlineDraft[] {
  const unique = new Map<number, Deadline>();
  for (const deadline of deadlines) unique.set(deadline.severity, deadline);
  return [...unique.values()]
    .sort((a, b) => a.severity - b.severity)
    .map(deadline => ({ id: nextDraftId(), ...deadline }));
}

function fromDrafts(drafts: readonly DeadlineDraft[]): Deadline[] {
  return drafts.map(({ severity, deadlineSeconds }) => ({ severity, deadlineSeconds }));
}

function deadlineFingerprint(deadlines: readonly Deadline[]): string {
  return JSON.stringify(
    deadlines.map(deadline => `${deadline.severity}:${deadline.deadlineSeconds}`).sort(),
  );
}

function firstUnused(used: readonly number[]): number | undefined {
  return KNOWN_SEVERITIES.find(severity => !used.includes(severity));
}

function severityOptions(current: number, used: readonly number[]): number[] {
  const taken = new Set(used.filter(severity => severity !== current));
  const available = KNOWN_SEVERITIES.filter(severity => !taken.has(severity));
  return available.includes(current) ? available : [...available, current].sort((a, b) => a - b);
}

function PrazosEditor({
  saved,
  initial,
  error,
  onReset,
}: {
  saved: Deadline[];
  initial: Deadline[];
  error: string | null | undefined;
  onReset: () => void;
}) {
  const saving = useNavigation().state === 'submitting';
  const [deadlines, setDeadlines] = useState(() => toDeadlineDrafts(initial));
  const dirty = deadlineFingerprint(fromDrafts(deadlines)) !== deadlineFingerprint(saved);

  function updateDeadline(id: string, patch: Partial<Omit<DeadlineDraft, 'id'>>) {
    setDeadlines(rows => rows.map(row => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addDeadline() {
    const severity = firstUnused(deadlines.map(row => row.severity));
    if (severity == null) return;
    setDeadlines(rows => [...rows, { id: nextDraftId(), severity, deadlineSeconds: 0 }]);
  }

  const usedSeverities = deadlines.map(row => row.severity);
  const canAddDeadline = firstUnused(usedSeverities) != null;

  return (
    <Form method="post">
      <PageHeader
        title="Prazos"
        subtitle="Tempo máximo de atendimento por prioridade. Vale para todas as origens."
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

      <Panel>
        <div className="flex flex-col gap-2">
          {deadlines.length === 0 && (
            <p className="text-sm text-text-dim">
              Nenhum prazo. Adicione as prioridades que o contrato cobre.
            </p>
          )}
          {deadlines.map(deadline => (
            <div
              key={deadline.id}
              className="flex flex-col gap-3 rounded-lg border border-border-base bg-bg-elevated p-3 sm:flex-row sm:items-center"
            >
              <select
                name="severity"
                value={deadline.severity}
                onChange={event =>
                  updateDeadline(deadline.id, { severity: Number(event.target.value) })
                }
                aria-label="Prioridade do prazo"
                className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[220px]`}
              >
                {severityOptions(deadline.severity, usedSeverities).map(severity => (
                  <option key={severity} value={severity}>
                    {severityLabel(severity)}
                  </option>
                ))}
              </select>
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="number"
                  name="deadlineSeconds"
                  min={0}
                  step={1}
                  value={deadline.deadlineSeconds}
                  onChange={event =>
                    updateDeadline(deadline.id, { deadlineSeconds: Number(event.target.value) })
                  }
                  aria-label={`Prazo em segundos para ${severityLabel(deadline.severity)}`}
                  className={`${inputClass} border-transparent bg-bg-tile sm:max-w-[180px]`}
                />
                <span className="text-text-dim text-xs">segundos</span>
              </div>
              <Badge tone="neutral">{formatDuration(deadline.deadlineSeconds)}</Badge>
              <button
                type="button"
                aria-label={`Remover prazo ${severityLabel(deadline.severity)}`}
                onClick={() => setDeadlines(rows => rows.filter(row => row.id !== deadline.id))}
                className={iconButtonClass(true)}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          {canAddDeadline && (
            <button type="button" onClick={addDeadline} className={dashedAddClass()}>
              <PlusIcon className="h-3.5 w-3.5 shrink-0" />
              Adicionar prazo
            </button>
          )}
        </div>
      </Panel>
    </Form>
  );
}

export default function Prazos({ loaderData, actionData }: Route.ComponentProps) {
  const { deadlines, revisions } = loaderData;
  return (
    <PrazosDraft
      key={deadlineFingerprint(deadlines)}
      saved={deadlines}
      revisions={revisions}
      error={actionData?.error}
    />
  );
}

function PrazosDraft({
  saved,
  revisions,
  error,
}: {
  saved: Deadline[];
  revisions: readonly HistoryRevision[];
  error: string | null | undefined;
}) {
  const [preview, setPreview] = useState<{ nonce: number; deadlines: Deadline[] } | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  return (
    <main className="p-6 sm:p-8">
      <PrazosEditor
        key={preview ? String(preview.nonce) : `saved-${resetNonce}`}
        saved={saved}
        initial={preview?.deadlines ?? saved}
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
            setPreview({ nonce: Date.now(), deadlines: payload as Deadline[] });
          }
        }}
      />
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Prazos" service="O serviço de configuração" />;
}
