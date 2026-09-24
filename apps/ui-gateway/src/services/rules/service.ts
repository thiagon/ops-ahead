import createError from 'http-errors';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import type { EventPublisher } from '../../lib/kafka.ts';
import { RulesPublish, type RulesTopics } from './publish.ts';
import type { DeadlineSet, Mapping, TargetSet } from './schema.ts';
import { RuleStore, type Stored } from './store.ts';

export interface RulesAccepted {
  key: string;
  topic: string;
}

export type HistoryItem<T> = T & { id: number; created_at: string };

/**
 * The business rules data-ingest translates against. Each PUT is stored and
 * published — accepted, never confirmed applied. GET history lists the last
 * ten; older copies remain. An older document is brought back by PUTting it.
 */
export class RulesService {
  #store: RuleStore;
  #publish: RulesPublish;

  constructor(publish: EventPublisher, topics: RulesTopics, prisma: PrismaClient) {
    this.#store = new RuleStore(prisma);
    this.#publish = new RulesPublish(publish, topics);
  }

  async setMapping(tenant: string, source: string, mapping: Mapping): Promise<RulesAccepted> {
    if (!(await this.#store.hasSource(tenant, source))) {
      throw createError.NotFound('no source is registered under this tenant and name');
    }
    await this.#store.appendMapping(tenant, source, mapping);
    try {
      return await this.#publish.publishMapping(tenant, source, mapping);
    } catch {
      throw createError.BadGateway('could not publish the event to the bus');
    }
  }

  async setDeadlines(tenant: string, deadlines: DeadlineSet): Promise<RulesAccepted> {
    await this.#store.appendDeadlines(tenant, deadlines);
    try {
      return await this.#publish.publishDeadlines(tenant, deadlines);
    } catch {
      throw createError.BadGateway('could not publish the event to the bus');
    }
  }

  async setTargets(tenant: string, targets: TargetSet): Promise<RulesAccepted> {
    await this.#store.appendTargets(tenant, targets);
    try {
      return await this.#publish.publishTargets(tenant, targets);
    } catch {
      throw createError.BadGateway('could not publish the event to the bus');
    }
  }

  async getMapping(tenant: string, source: string): Promise<Mapping> {
    return requireRow(await this.#store.latestMapping(tenant, source)).document;
  }

  async getDeadlines(tenant: string): Promise<DeadlineSet> {
    return requireRow(await this.#store.latestDeadlines(tenant)).document;
  }

  async getTargets(tenant: string): Promise<TargetSet> {
    return requireRow(await this.#store.latestTargets(tenant)).document;
  }

  async listMappingHistory(tenant: string, source: string): Promise<HistoryItem<Mapping>[]> {
    return (await this.#store.listMappings(tenant, source)).map(toHistory);
  }

  async listDeadlineHistory(tenant: string): Promise<HistoryItem<DeadlineSet>[]> {
    return (await this.#store.listDeadlines(tenant)).map(toHistory);
  }

  async listTargetHistory(tenant: string): Promise<HistoryItem<TargetSet>[]> {
    return (await this.#store.listTargets(tenant)).map(toHistory);
  }
}

function requireRow<T>(row: Stored<T> | undefined): Stored<T> {
  if (!row) throw createError.NotFound('no rule is stored under this key');
  return row;
}

function toHistory<T>(row: Stored<T>): HistoryItem<T> {
  return { ...row.document, id: row.id, created_at: row.createdAt.toISOString() };
}
