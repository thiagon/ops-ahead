import type { EventPublisher } from '../../plugins/kafka.ts';
import type { AnalysisRequest } from './schema.ts';

const ANALYSIS_DOMAIN: Record<AnalysisRequest['analysis'], 'ml' | 'data'> = {
  volume_forecast: 'ml',
  entity_forecast: 'ml',
  breach_risk: 'ml',
  kpi_projection: 'ml',
  external_event_detection: 'ml',
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

  async send(id: string, request: AnalysisRequest, updateKey: string): Promise<void> {
    // Provenance stays in the gateway's own row: the trigger contracts declare
    // additionalProperties: false, and what started a run is not something the
    // consumer acts on.
    const { trigger: _trigger, parent_id: _parentId, ...event } = request;
    await this.#publish.publish({
      topic: this.topicFor(request.analysis),
      key: id,
      value: JSON.stringify({ run_id: id, update_key: updateKey, ...event }),
    });
  }
}
