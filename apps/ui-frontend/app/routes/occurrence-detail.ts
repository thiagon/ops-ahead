import {
  fetchMilestones,
  fetchOpenAlert,
  fetchSeverityHistory,
  fetchSimilarIncidents,
} from '~/clickhouse.server.ts';
import { buildTimeline } from '~/components/Timeline';
import { dataResponse } from '~/data-response.server.ts';
import type { Route } from './+types/occurrence-detail';

/**
 * The drill-down's per-row data. The panel fetches this URL from the browser
 * so a failure shows up in the network panel with its body.
 */
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
