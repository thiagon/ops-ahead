import { Link } from 'react-router';
import { Badge, severityTone } from '~/components/Badge';
import { PageHeader } from '~/components/PageHeader';
import { RouteError } from '~/components/RouteError';
import { loadQueue, type QueueRow } from '~/queue.server.ts';
import { formatRatio, formatRemaining, riskColor, SEVERITY_LABEL } from '~/risk.ts';
import type { Route } from './+types/queue';

export function meta() {
  return [{ title: 'Fila de ocorrências · Ops Ahead' }];
}

export async function loader() {
  return { rows: await loadQueue() };
}

function ConsumedBar({ row }: { row: QueueRow }) {
  const color = riskColor(row.consumed_ratio);
  return (
    <div className="min-w-40">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm" style={{ color }}>
          {formatRatio(row.consumed_ratio)}
        </span>
        <span className="font-mono text-text-dim text-xs">
          {formatRemaining(row.time_remaining_seconds)}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(row.consumed_ratio, 1) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

function RiskScore({ probability }: { probability: number | null }) {
  if (probability === null) {
    return (
      <span className="font-mono text-text-dim text-xs" title="ml-model-serving não respondeu">
        —
      </span>
    );
  }
  return (
    <span className="font-mono text-sm" style={{ color: riskColor(probability) }}>
      {formatRatio(probability)}
    </span>
  );
}

export default function Queue({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;

  return (
    <main className="px-8 py-6">
      <PageHeader
        title="Fila de ocorrências"
        subtitle="Ocorrências vivas, ordenadas pelo prazo vigente — o que está prestes a estourar aparece primeiro."
      />

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border-base bg-bg-tile p-6 text-text-muted">
          Nenhuma ocorrência aberta no momento.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-border-base">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-bg-tile text-text-muted text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3">Ocorrência</th>
                <th className="px-4 py-3">Severidade</th>
                <th className="px-4 py-3">Grupo</th>
                <th className="px-4 py-3">Prazo consumido</th>
                <th className="px-4 py-3">Risco</th>
                <th className="px-4 py-3">Reconhecida</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={`${row.source}/${row.external_id}`}
                  className="border-border-base border-t hover:bg-bg-tile"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/ocorrencias/${encodeURIComponent(row.source)}/${encodeURIComponent(row.external_id)}`}
                      className="font-mono text-text-light hover:text-accent-red"
                    >
                      {row.external_id}
                    </Link>
                    <p className="mt-0.5 max-w-xs truncate text-text-muted text-xs">{row.title}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={severityTone(row.severity)}>
                      {SEVERITY_LABEL[row.severity] ?? row.severity}
                    </Badge>
                    {row.severity_changes > 0 && (
                      <span
                        className="ml-2 text-signal-purple text-xs"
                        title="Prazo recalculado na recategorização"
                      >
                        recategorizada
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{row.owner || '—'}</td>
                  <td className="px-4 py-3">
                    <ConsumedBar row={row} />
                  </td>
                  <td className="px-4 py-3">
                    <RiskScore probability={row.breach_probability} />
                  </td>
                  <td className="px-4 py-3">
                    {row.acknowledged ? (
                      <Badge tone="green">sim</Badge>
                    ) : (
                      <Badge tone="amber">não</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Fila" service="O banco de dados" />;
}
