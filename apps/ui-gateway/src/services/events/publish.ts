import type { EventPublisher } from '#lib/kafka.ts';
import type { EventEnvelope } from './schema.ts';

export interface EventsTopics {
  alert: string;
  monitor: string;
}

/**
 * Publishes the raw envelope onto the topic that matches the origin's intake
 * (domain/ubiquitous-language.md#intake). The gateway never interprets the
 * payload; it only chooses the stream the origin was registered for.
 */
export class EventsPublish {
  #publish: EventPublisher;
  #topics: EventsTopics;

  constructor(publish: EventPublisher, topics: EventsTopics) {
    this.#publish = publish;
    this.#topics = topics;
  }

  topicFor(intake: EventEnvelope['intake']): string {
    return intake === 'alert' ? this.#topics.alert : this.#topics.monitor;
  }

  async send(envelope: EventEnvelope): Promise<void> {
    await this.#publish.publish({
      topic: this.topicFor(envelope.intake),
      key: envelope.event_id,
      value: JSON.stringify(envelope),
    });
  }

  async sendBatch(envelopes: EventEnvelope[]): Promise<void> {
    await this.#publish.publishBatch(
      envelopes.map(envelope => ({
        topic: this.topicFor(envelope.intake),
        key: envelope.event_id,
        value: JSON.stringify(envelope),
      })),
    );
  }
}
