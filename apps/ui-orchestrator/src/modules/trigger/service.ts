import { randomUUID } from 'node:crypto';
import type { EventPublisher } from '../../plugins/kafka.ts';
import type { TriggerRequest } from './schema.ts';

interface TopicEnv {
  KAFKA_TOPIC_ML: string;
  KAFKA_TOPIC_DATA: string;
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
  app: { env: TopicEnv },
): string {
  return ANALYSIS_DOMAIN[analysis] === 'ml' ? app.env.KAFKA_TOPIC_ML : app.env.KAFKA_TOPIC_DATA;
}

/**
 * Shared by the REST route and the MCP tool — mint a run_id, publish the
 * event, done. Neither caller touches Kafka directly.
 */
export async function triggerAnalysis(
  app: { env: TopicEnv; kafka: EventPublisher },
  request: TriggerRequest,
): Promise<TriggerResult> {
  const run_id = randomUUID();
  const event = { run_id, ...request };
  const topic = topicForAnalysis(request.analysis, app);

  await app.kafka.publish(topic, { key: run_id, value: JSON.stringify(event) });

  return { run_id };
}
