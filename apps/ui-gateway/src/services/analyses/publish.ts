import type { EventPublisher } from '#lib/kafka.ts';
import type { AnalysisRequest } from './schema.ts';

const ANALYSIS_DOMAIN: Record<AnalysisRequest['analysis'], 'ml' | 'data'> = {
  volume_forecast: 'ml',
  entity_forecast: 'ml',
  breach_risk: 'ml',
  recurring_causes: 'ml',
  kpi_projection: 'ml',
  external_event_detection: 'ml',
  drift_monitoring: 'ml',
  data_refresh: 'data',
  data_quality_check: 'data',
  full_pipeline: 'data',
};

export class AnalysisPublish {
  #publish: EventPublisher;
  #topics: { ml: string; data: string };

  constructor(publish: EventPublisher, topics: { ml: string; data: string }) {
    this.#publish = publish;
    this.#topics = topics;
  }

  topicFor(analysis: AnalysisRequest['analysis']): string {
    return this.#topics[ANALYSIS_DOMAIN[analysis]];
  }

  async send(id: string, request: AnalysisRequest, runKey: string): Promise<void> {
    // Provenance stays in the gateway's own row: the trigger contracts declare
    // additionalProperties: false, and what started a run is not something the
    // consumer acts on.
    await this.#publish.publish({
      topic: this.topicFor(request.analysis),
      key: id,
      value: JSON.stringify({ run_id: id, run_key: runKey, ...request }),
    });
  }
}
