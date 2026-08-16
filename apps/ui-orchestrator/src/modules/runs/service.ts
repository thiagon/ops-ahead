import type { FastifyInstance } from 'fastify';
import type { RunStatus } from './schema.ts';

/**
 * Shared by the REST route and the MCP tool. Lookup only — never touches
 * Kubernetes; a run absent from the map is "queued", not an error (see
 * conductor/tracks/exec-trigger_20260807/spec.md).
 */
export function getRunStatus(app: Pick<FastifyInstance, 'runStatus'>, runId: string): RunStatus {
  const status = app.runStatus.get(runId);
  return status ?? { run_id: runId, status: 'queued' };
}
