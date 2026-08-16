import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { RunStatus } from '../modules/runs/schema.ts';

/**
 * In-memory read model for run status, shared by the REST route
 * (modules/runs) and the MCP tool (modules/mcp) via `app.runsService` — both
 * need the same instance.
 */
export class RunsService {
  private readonly statuses = new Map<string, RunStatus>();

  recordStatus(status: RunStatus): void {
    this.statuses.set(status.run_id, status);
  }

  /** A run absent from the map is "queued", not an error. */
  getStatus(runId: string): RunStatus {
    return this.statuses.get(runId) ?? { run_id: runId, status: 'queued' };
  }
}

/** Never throws — a malformed message must not crash the consumer loop. */
export function parseStatusMessage(raw: Buffer | undefined): RunStatus | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'run_id' in parsed &&
      typeof (parsed as { run_id: unknown }).run_id === 'string'
    ) {
      return parsed as RunStatus;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    runsService: RunsService;
  }
}

// Awaited directly in the plugin body, blocking app.ready(): GET /runs must
// never answer before the backlog is replayed, or a restart would report
// every past run as "queued" until its next status update happens to arrive.
async function runStatusPlugin(app: FastifyInstance) {
  const service = new RunsService();
  app.decorate('runsService', service);

  await app.kafkaConsumers.consumeWithBacklogReplay(app.env.KAFKA_TOPIC_STATUS, message => {
    const status = parseStatusMessage(message.value);
    if (status) service.recordStatus(status);
  });
}

export default fp(runStatusPlugin, { name: 'run-status', dependencies: ['env', 'kafka'] });
