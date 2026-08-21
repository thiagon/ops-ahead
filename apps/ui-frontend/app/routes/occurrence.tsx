import { Link } from 'react-router';
import {
  fetchBreachContext,
  fetchMilestones,
  fetchOpenAlert,
  fetchSeverityHistory,
} from '~/clickhouse.server.ts';
import { predictBreach } from '~/model-serving.server.ts';
import { buildQueue } from '~/queue.server.ts';
import {
  formatRatio,
  formatRemaining,
  MILESTONE_LABEL,
  riskColor,
  SEVERITY_LABEL,
} from '~/risk.ts';
import type { Route } from './+types/occurrence';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.externalId} · Ops Ahead` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const { source, externalId } = params;
  const alert = await fetchOpenAlert(source, externalId);
  if (!alert) {
    throw new Response('Ocorrência não encontrada entre as abertas', { status: 404 });
  }

  const [milestones, severityHistory, context] = await Promise.all([
    fetchMilestones(source, externalId),
    fetchSeverityHistory(source, externalId),
    fetchBreachContext().catch(() => ({})),
  ]);

  // Same fail-open path as the queue, over this one row.
  const [occurrence] = await buildQueue({
    query: async () => [alert],
    score: predictBreach,
    context,
  });

  if (!occurrence) {
    throw new Response('Ocorrência não encontrada entre as abertas', { status: 404 });
  }

  return {
    occurrence,
    entityId: alert.entity_id,
    acknowledgedAt: alert.acknowledged_at,
    milestones,
    severityHistory,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-text-dim text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-text-light">{children}</dd>
    </div>
  );
}

export default function Occurrence({ loaderData }: Route.ComponentProps) {
  const { occurrence, entityId, acknowledgedAt, milestones, severityHistory } = loaderData;
  const color = riskColor(occurrence.consumed_ratio);

  return (
    <main className="container mx-auto max-w-4xl p-8">
      <Link to="/fila" className="text-sm text-text-muted hover:text-text-light">
        ← Fila de ocorrências
      </Link>

      <h1 className="mt-4 font-mono font-semibold text-2xl text-text-light">
        {occurrence.external_id}
      </h1>
      <p className="mt-1 text-text-muted">{occurrence.title}</p>

      <section className="mt-8 rounded-lg border border-border-base bg-bg-tile p-6">
        <h2 className="font-semibold text-lg text-text-light">Prazo vigente</h2>
        <p className="mt-1 text-sm text-text-muted">
          Recalculado a cada recategorização, nunca continuado do prazo original.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <Field label="Severidade">
            {SEVERITY_LABEL[occurrence.severity] ?? occurrence.severity}
          </Field>
          <Field label="Vence em">
            <span className="font-mono">{occurrence.due_at}</span>
          </Field>
          <Field label="Restante">
            <span className="font-mono" style={{ color }}>
              {formatRemaining(occurrence.time_remaining_seconds)}
            </span>
          </Field>
          <Field label="Consumido">
            <span className="font-mono" style={{ color }}>
              {formatRatio(occurrence.consumed_ratio)}
            </span>
          </Field>
          <Field label="Grupo">{occurrence.owner || '—'}</Field>
          <Field label="Recurso">{entityId || '—'}</Field>
          <Field label="Reconhecida">
            {acknowledgedAt ? (
              <span className="font-mono text-signal-green text-sm">{acknowledgedAt}</span>
            ) : (
              <span className="text-signal-amber">não</span>
            )}
          </Field>
          <Field label="Risco de estouro">
            {occurrence.breach_probability === null ? (
              <span className="text-text-dim">—</span>
            ) : (
              <span
                className="font-mono"
                style={{ color: riskColor(occurrence.breach_probability) }}
              >
                {formatRatio(occurrence.breach_probability)}
              </span>
            )}
          </Field>
        </dl>

        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-bg-elevated">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(occurrence.consumed_ratio, 1) * 100}%`,
              backgroundColor: color,
            }}
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border-base bg-bg-tile p-6">
        <h2 className="font-semibold text-lg text-text-light">Marcos já cruzados</h2>
        {milestones.length === 0 ? (
          <p className="mt-2 text-text-muted">Nenhum marco emitido para esta ocorrência.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {milestones.map(milestone => (
              <li
                key={`${milestone.kind}-${milestone.occurred_at}`}
                className="flex items-baseline gap-4"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: riskColor(milestone.consumed_ratio) }}
                />
                <span className="w-40 text-text-light">
                  {MILESTONE_LABEL[milestone.kind] ?? milestone.kind}
                </span>
                <span className="font-mono text-sm text-text-muted">{milestone.occurred_at}</span>
                <span className="font-mono text-text-dim text-xs">
                  severidade {milestone.severity} · {formatRatio(milestone.consumed_ratio)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-border-base bg-bg-tile p-6">
        <h2 className="font-semibold text-lg text-text-light">Histórico de severidade</h2>
        <p className="mt-1 text-sm text-text-muted">
          Aberta como {SEVERITY_LABEL[severityHistory[0]?.severity_from ?? occurrence.severity]} em{' '}
          <span className="font-mono">{occurrence.opened_at}</span>.
        </p>
        {severityHistory.length === 0 ? (
          <p className="mt-3 text-text-muted">Sem recategorização.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {severityHistory.map(change => (
              <li key={change.received_at} className="flex items-baseline gap-4">
                <span className="font-mono text-sm text-text-muted">{change.received_at}</span>
                <span className="text-text-light">
                  {SEVERITY_LABEL[change.severity_from] ?? change.severity_from} →{' '}
                  {SEVERITY_LABEL[change.severity_to] ?? change.severity_to}
                </span>
                {change.severity_to < change.severity_from && (
                  <span className="text-signal-amber text-xs">prazo encurtado</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
