import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { readJson } from '~/client-fetch.ts';
import { Badge, severityTone } from '~/components/Badge';
import { SearchIcon } from '~/components/icons';
import { LoadingScreen } from '~/components/LoadingScreen';
import { PageHeader } from '~/components/PageHeader';
import { RouteError } from '~/components/RouteError';
import { occurrencePath, useTenantSlug } from '~/paths';
import { formatRatio, formatRemaining, riskColor, SEVERITY_LABEL } from '~/risk.ts';
import type { QueueRow } from '~/types.ts';
import type { Route } from './+types/queue';

export function meta() {
  return [{ title: 'Fila de ocorrências · Ops Ahead' }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const tenant = params.tenant;
  if (!tenant) throw new Response('Tenant ausente', { status: 400 });
  return readJson<{ rows: QueueRow[] }>(`/data/${encodeURIComponent(tenant)}/queue`);
}

export function HydrateFallback() {
  return <LoadingScreen title="Fila de ocorrências" />;
}

function ConsumedBar({ row }: { row: QueueRow }) {
  const color = riskColor(row.consumed_ratio);
  return (
    <div className="min-w-28 max-w-40 flex-1">
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
      <span className="font-mono text-text-dim text-xs" title="Score indisponível">
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

function matches(row: QueueRow, query: string): boolean {
  if (!query) return true;
  const haystack = [row.external_id, row.title, row.owner, row.source].join(' ').toLowerCase();
  return haystack.includes(query);
}

export default function Queue({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  const tenant = useTenantSlug();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => rows.filter(row => matches(row, needle)), [rows, needle]);

  return (
    <main className="px-4 py-6 sm:px-8">
      <PageHeader
        title="Fila de ocorrências"
        subtitle="Ocorrências vivas, ordenadas pelo prazo vigente — o que está prestes a estourar aparece primeiro."
      />

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-border-base bg-bg-tile p-6 text-text-muted">
          Nenhuma ocorrência aberta no momento.
        </p>
      ) : (
        <div className="mt-6">
          <label className="flex items-center gap-2 rounded-lg border border-border-base bg-bg-tile px-3 py-2 text-sm text-text-muted focus-within:border-signal-blue/40">
            <SearchIcon className="h-4 w-4 shrink-0" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filtrar por id, título, grupo…"
              className="min-w-0 flex-1 bg-transparent text-text-light outline-none placeholder:text-text-dim"
            />
            <span className="shrink-0 font-mono text-text-dim text-xs">
              {visible.length}/{rows.length}
            </span>
          </label>

          {visible.length === 0 ? (
            <p className="mt-4 text-sm text-text-muted">Nada bate com “{query.trim()}”.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-base rounded-lg border border-border-base">
              {visible.map(row => (
                <li key={`${row.source}/${row.external_id}`}>
                  <Link
                    to={occurrencePath(tenant, row.source, row.external_id)}
                    className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-bg-tile sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-text-light">{row.external_id}</span>
                        <Badge tone={severityTone(row.severity)}>
                          {SEVERITY_LABEL[row.severity] ?? row.severity}
                        </Badge>
                        {row.severity_changes > 0 && (
                          <span
                            className="text-signal-purple text-xs"
                            title="Prazo recalculado na recategorização"
                          >
                            recategorizada
                          </span>
                        )}
                        {row.acknowledged ? (
                          <Badge tone="green">reconhecida</Badge>
                        ) : (
                          <Badge tone="amber">não reconhecida</Badge>
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-text-muted">{row.title}</p>
                      <p className="mt-0.5 text-text-dim text-xs">{row.owner || 'sem grupo'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-6 sm:w-72">
                      <ConsumedBar row={row} />
                      <div className="w-14 text-right">
                        <p className="text-[10px] text-text-dim uppercase tracking-wide">Risco</p>
                        <RiskScore probability={row.breach_probability} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <RouteError error={error} title="Fila" service="A fila" />;
}
