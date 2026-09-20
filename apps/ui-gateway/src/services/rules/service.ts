import type { EventPublisher } from '../../plugins/kafka.ts';
import { RulesPublish, type RulesTopics } from './publish.ts';
import type { DeadlineSet, Mapping, TargetSet } from './schema.ts';

export interface RulesAccepted {
  key: string;
  topic: string;
}

/**
 * The business rules data-ingest translates against: how one origin's payload
 * maps onto the domain, a tenant's deadlines, and its KPI targets. The gateway
 * is the only writer — consumers rehydrate from the compacted topics and
 * converge on their own, so a write here is accepted, never confirmed applied.
 */
export class RulesService {
  #publish: RulesPublish;

  constructor(publish: EventPublisher, topics: RulesTopics) {
    this.#publish = new RulesPublish(publish, topics);
  }

  async setMapping(tenant: string, source: string, mapping: Mapping): Promise<RulesAccepted> {
    return this.#publish.publishMapping(tenant, source, mapping);
  }

  async setDeadlines(tenant: string, deadlines: DeadlineSet): Promise<RulesAccepted> {
    return this.#publish.publishDeadlines(tenant, deadlines);
  }

  async setTargets(tenant: string, targets: TargetSet): Promise<RulesAccepted> {
    return this.#publish.publishTargets(tenant, targets);
  }
}
