import {
  fetchBreachContext,
  fetchMilestones,
  fetchOpenAlert,
  fetchSeverityHistory,
} from '~/clickhouse.server.ts';
import { dataResponse } from '~/data-response.server.ts';
import { predictBreach } from '~/model-serving.server.ts';
import { buildQueue } from '~/queue.server.ts';
import type { Route } from './+types/occurrence';

export async function loader({ request, params }: Route.LoaderArgs) {
  return dataResponse(request, params.tenant, async () => {
    const { source, externalId } = params;
    if (!source || !externalId) {
      throw new Response('Ocorrência não encontrada entre as abertas', { status: 404 });
    }

    const alert = await fetchOpenAlert(source, externalId);
    if (!alert) {
      throw new Response('Ocorrência não encontrada entre as abertas', { status: 404 });
    }

    const [milestones, severityHistory, context] = await Promise.all([
      fetchMilestones(source, externalId),
      fetchSeverityHistory(source, externalId),
      fetchBreachContext(),
    ]);

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
  });
}
