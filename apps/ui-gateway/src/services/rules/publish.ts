import type { EventPublisher } from '../../plugins/kafka.ts';

export interface RulesTopics {
  mapping: string;
  deadline: string;
  target: string;
}

/**
 * Publishes onto the compacted rules.* topics, which are the store: the
 * broker retains the last record per key, and every consumer rebuilds its
 * state by replaying the log from the beginning. Nothing is written anywhere
 * else for a record to take effect.
 *
 * Append-only: every publish replaces the prior record under the same key,
 * and nothing retracts one. The tombstone path still works downstream
 * (config_stream.py) — this layer just never sends one.
 */
export class RulesPublish {
  #publish: EventPublisher;
  #topics: RulesTopics;

  constructor(publish: EventPublisher, topics: RulesTopics) {
    this.#publish = publish;
    this.#topics = topics;
  }

  /**
   * Field bindings and value dictionary in one record: a mapping that says
   * "this value means severity 1" is meaningless without the binding that
   * says which field carries it, so neither half stands alone.
   */
  async publishMapping(
    tenant: string,
    source: string,
    record: Record<string, unknown>,
  ): Promise<{ key: string; topic: string }> {
    return this.#send(this.#topics.mapping, `${tenant}:${source}`, {
      tenant_id: tenant,
      source,
      ...record,
    });
  }

  async publishDeadlines(
    tenant: string,
    record: Record<string, unknown>,
  ): Promise<{ key: string; topic: string }> {
    return this.#send(this.#topics.deadline, tenant, { tenant_id: tenant, ...record });
  }

  async publishTargets(
    tenant: string,
    record: Record<string, unknown>,
  ): Promise<{ key: string; topic: string }> {
    return this.#send(this.#topics.target, tenant, { tenant_id: tenant, ...record });
  }

  async #send(
    topic: string,
    key: string,
    record: Record<string, unknown>,
  ): Promise<{ key: string; topic: string }> {
    await this.#publish.publish({ topic, key, value: JSON.stringify(record) });
    return { key, topic };
  }
}
