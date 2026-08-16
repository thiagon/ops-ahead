import { randomUUID } from 'node:crypto';
import type { TriggerRequest } from './schema.ts';

/** Resolved from `app.kafka` at the edge; this file never imports Fastify. */
export interface EventPublisher {
  publish(topic: string, message: { key: string; value: string }): Promise<void>;
}

export interface TriggerTopics {
  ml: string;
  data: string;
}

/**
 * Which topic each `analysis` routes to — the only decision ui-orchestrator
 * makes. `analysis` itself travels intact into the message, same value the
 * caller sent: there is no separate internal vocabulary to translate into
 * (see conductor/tracks/exec-trigger_20260807/payloads.md).
 */
const ANALYSIS_DOMAIN: Record<TriggerRequest['analysis'], 'ml' | 'data'> = {
  volume_forecast: 'ml',
  breach_risk: 'ml',
  data_refresh: 'data',
  data_quality_check: 'data',
};

export interface TriggerResult {
  run_id: string;
}

export function topicForAnalysis(
  analysis: TriggerRequest['analysis'],
  topics: TriggerTopics,
): string {
  return ANALYSIS_DOMAIN[analysis] === 'ml' ? topics.ml : topics.data;
}

/**
 * Shared by the REST route and the MCP tool — mint a run_id, publish the
 * event, done. Neither caller touches Kafka directly.
 */
export async function triggerAnalysis(
  publisher: EventPublisher,
  topics: TriggerTopics,
  request: TriggerRequest,
): Promise<TriggerResult> {
  const run_id = randomUUID();
  const event = { run_id, ...request };
  const topic = topicForAnalysis(request.analysis, topics);

  await publisher.publish(topic, { key: run_id, value: JSON.stringify(event) });

  return { run_id };
}
