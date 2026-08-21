import {
  fetchMilestones,
  fetchOpenAlert,
  fetchSeverityHistory,
  fetchSimilarIncidents,
} from '~/clickhouse.server.ts';
import { buildTimeline } from '~/components/Timeline';
import type { Route } from './+types/occurrence-detail';

/**
 * The drill-down's per-row data — timeline and similar incidents are only
 * worth fetching for the selected recommendation, not every row in the queue.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const { source, externalId } = params;
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
}
