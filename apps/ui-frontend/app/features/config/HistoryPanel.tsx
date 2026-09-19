import { GhostButton } from '~/components/form';
import { HistoryIcon } from '~/components/icons';
import { Panel } from '~/components/Panel';

export type HistoryRevision = {
  id: number;
  summary: string;
  at: string;
  revertible: boolean;
  payload: unknown;
};

function formatAt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryPanel({
  revisions,
  error,
  onRestore,
}: {
  revisions: readonly HistoryRevision[];
  error?: string | null;
  onRestore: (payload: unknown) => void;
}) {
  return (
    <Panel className="mt-6">
      <div className="mb-4 flex items-center gap-2.5">
        <HistoryIcon className="h-5 w-5 text-text-muted" />
        <h2 className="font-semibold text-text-light text-xl">Histórico</h2>
      </div>
      {error && (
        <p className="mb-4 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-accent-red text-sm">
          {error}
        </p>
      )}

      {revisions.length === 0 ? (
        <p className="text-sm text-text-dim">Nenhuma alteração publicada ainda.</p>
      ) : (
        <div className="flex flex-col">
          {revisions.map(revision => (
            <div
              key={revision.id}
              className="flex flex-col gap-2 border-border-base border-b py-3 first:pt-0 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-text-light">{revision.summary}</p>
                <p className="text-text-dim text-xs">{formatAt(revision.at)}</p>
              </div>
              {revision.revertible && (
                <GhostButton onClick={() => onRestore(revision.payload)}>Visualizar</GhostButton>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
