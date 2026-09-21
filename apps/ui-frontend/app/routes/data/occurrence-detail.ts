import {
  fetchMilestones,
  fetchOpenAlert,
  fetchSeverityHistory,
  fetchSimilarIncidents,
} from '~/clickhouse.server.ts';
import { buildTimeline } from '~/components/Timeline';
import { dataResponse } from '~/data-response.server.ts';
import type { Route } from './+types/occurrence-detail';

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

    const [milestones, severityHistory, similarIncidents] = await Promise.all([
      fetchMilestones(source, externalId),
      fetchSeverityHistory(source, externalId),
      fetchSimilarIncidents(alert.owner, alert.severity, externalId),
    ]);

    return {
      timeline: buildTimeline(milestones, severityHistory),
      similarIncidents,
    };
  });
}
