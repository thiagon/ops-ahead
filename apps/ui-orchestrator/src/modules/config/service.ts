import { randomBytes, randomUUID } from 'node:crypto';
import type { Sql } from 'postgres';
import type {
  ConfigDomain,
  Deadline,
  Intake,
  Integration,
  KpiTarget,
  MappingField,
} from './schema.ts';
import type { SecretStore } from './vault.ts';

/** Resolved from `app.kafka` at the edge; this file never imports Fastify. */
export interface EventPublisher {
  publish(topic: string, message: { key: string; value: string }): Promise<void>;
}

export interface ConfigTopics {
  origin: string;
  dictionary: string;
  deadline: string;
  kpiTarget: string;
}

export class ConfigNotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}

export class ConfigConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'Conflict';
  }
}

/** Keys the compacted topics are partitioned and compacted by (spec §2). */
export function originTopicKey(tenantId: string, source: string): string {
  return `${tenantId}:${source}`;
}

type IntegrationRow = {
  source: string;
  intake: Intake;
  envelope_version: string;
  secret_created_at: Date | null;
  enabled: boolean;
  dictionary_version: string | null;
  dictionary_status: 'published' | 'draft' | null;
};

type BindingRow = { source: string; field: string; path: string | null };
type MappingRow = {
  source: string;
  id: string;
  mapping_field: MappingField;
  from_value: string;
  to_value: string;
};

function composeIntegrations(
  rows: readonly IntegrationRow[],
  bindings: readonly BindingRow[],
  mappings: readonly MappingRow[],
): Integration[] {
  return rows.map(row => ({
    source: row.source,
    intake: row.intake,
    envelopeVersion: row.envelope_version,
    secretCreatedAt: row.secret_created_at?.toISOString() ?? null,
    enabled: row.enabled,
    dictionaryVersion: row.dictionary_version,
    dictionaryStatus: row.dictionary_status,
    bindings: bindings
      .filter(binding => binding.source === row.source)
      .map(({ field, path }) => ({ field, path })),
    mappings: mappings
      .filter(mapping => mapping.source === row.source)
      .reduce<Integration['mappings']>((acc, mapping) => {
        const entries = acc[mapping.mapping_field] ?? [];
        entries.push({ id: mapping.id, from: mapping.from_value, to: mapping.to_value });
        acc[mapping.mapping_field] = entries;
        return acc;
      }, {}),
  }));
}

/**
 * Reads the registry and, on every write, publishes the resulting state to the
 * compacted topic its consumers rehydrate from. Postgres answers the screens;
 * Kafka is what the pipeline reads (apps/ui-frontend/spec/config-ui.md §2).
 */
export class ConfigService {
  private readonly sql: Sql;
  private readonly publisher: EventPublisher;
  private readonly topics: ConfigTopics;
  private readonly secrets: SecretStore;

  constructor(sql: Sql, publisher: EventPublisher, topics: ConfigTopics, secrets: SecretStore) {
    this.sql = sql;
    this.publisher = publisher;
    this.topics = topics;
    this.secrets = secrets;
  }

  async listIntegrations(tenantId: string): Promise<Integration[]> {
    const rows = await this.sql<IntegrationRow[]>`
      SELECT o.source, o.intake, o.envelope_version, o.secret_created_at, o.enabled,
             d.version AS dictionary_version, d.status AS dictionary_status
        FROM config_origin o
        LEFT JOIN config_dictionary_version d
               ON d.tenant_id = o.tenant_id AND d.source = o.source
       WHERE o.tenant_id = ${tenantId}
       ORDER BY o.source`;

    const [bindings, mappings] = await Promise.all([
      this.sql<BindingRow[]>`
        SELECT source, field, path FROM config_field_binding
         WHERE tenant_id = ${tenantId} ORDER BY source, field`,
      this.sql<MappingRow[]>`
        SELECT source, id, mapping_field, from_value, to_value FROM config_mapping
         WHERE tenant_id = ${tenantId} ORDER BY source, mapping_field, from_value`,
    ]);

    return composeIntegrations(rows, bindings, mappings);
  }

  async getIntegration(tenantId: string, source: string): Promise<Integration> {
    const integrations = await this.listIntegrations(tenantId);
    const found = integrations.find(integration => integration.source === source);
    if (!found) throw new ConfigNotFoundError(`integration ${source} not found`);
    return found;
  }

  async listDeadlines(tenantId: string): Promise<Deadline[]> {
    const rows = await this.sql<{ severity: number; deadline_seconds: number }[]>`
      SELECT severity, deadline_seconds FROM config_deadline
       WHERE tenant_id = ${tenantId} ORDER BY severity`;
    return rows.map(row => ({ severity: row.severity, deadlineSeconds: row.deadline_seconds }));
  }

  async listKpiTargets(tenantId: string): Promise<KpiTarget[]> {
    const rows = await this.sql<
      { kpi_group: string; max_breaches: number; achievement_pct: string }[]
    >`
      SELECT kpi_group, max_breaches, achievement_pct FROM config_kpi_target
       WHERE tenant_id = ${tenantId} ORDER BY kpi_group, achievement_pct DESC`;
    return rows.map(row => ({
      kpiGroup: row.kpi_group,
      maxBreaches: row.max_breaches,
      achievementPct: Number(row.achievement_pct),
    }));
  }

  async listRevisions(tenantId: string) {
    const rows = await this.sql<
      { id: string; domain: ConfigDomain; summary: string; author: string; at: Date }[]
    >`
      SELECT id, domain, summary, author, at FROM config_revision
       WHERE tenant_id = ${tenantId} ORDER BY at DESC LIMIT 50`;
    return rows.map(row => ({ ...row, at: row.at.toISOString() }));
  }

  // ─── writes ────────────────────────────────────────────────────────────────

  /**
   * Publishes the current state of one domain to its compacted topic. Called
   * after every write inside the same request: a consumer that restarts must
   * find the registry's state in the log, not a delta it has to replay in
   * order.
   */
  private async publishOrigin(tenantId: string, source: string): Promise<void> {
    const integration = await this.getIntegration(tenantId, source);
    await this.publisher.publish(this.topics.origin, {
      key: originTopicKey(tenantId, source),
      value: JSON.stringify({
        tenant_id: tenantId,
        source,
        intake: integration.intake,
        envelope_version: integration.envelopeVersion,
        enabled: integration.enabled,
        bindings: integration.bindings,
      }),
    });
  }

  private async publishDictionary(tenantId: string, source: string): Promise<void> {
    const integration = await this.getIntegration(tenantId, source);
    const mappings = Object.fromEntries(
      Object.entries(integration.mappings).map(([field, entries]) => [
        field,
        Object.fromEntries((entries ?? []).map(entry => [entry.from, entry.to])),
      ]),
    );
    await this.publisher.publish(this.topics.dictionary, {
      key: originTopicKey(tenantId, source),
      value: JSON.stringify({
        tenant_id: tenantId,
        source,
        intake: integration.intake,
        dictionary_version: integration.dictionaryVersion ?? 'v1',
        mappings,
      }),
    });
  }

  private async publishDeadlines(tenantId: string): Promise<void> {
    const items = await this.listDeadlines(tenantId);
    await this.publisher.publish(this.topics.deadline, {
      key: tenantId,
      value: JSON.stringify({
        tenant_id: tenantId,
        deadlines: items.map(item => ({
          severity: item.severity,
          deadline_seconds: item.deadlineSeconds,
        })),
      }),
    });
  }

  private async publishKpiTargets(tenantId: string): Promise<void> {
    const items = await this.listKpiTargets(tenantId);
    await this.publisher.publish(this.topics.kpiTarget, {
      key: tenantId,
      value: JSON.stringify({
        tenant_id: tenantId,
        targets: items.map(item => ({
          kpi_group: item.kpiGroup,
          max_breaches: item.maxBreaches,
          achievement_pct: item.achievementPct,
        })),
      }),
    });
  }

  /**
   * Append-only. `previous` is the state as it stood *before* this change —
   * restoring it is what a rollback does, so a revision recording the new
   * state would revert to itself.
   */
  private async recordRevision(
    tenantId: string,
    domain: ConfigDomain,
    configKey: string,
    summary: string,
    author: string,
    previous: unknown,
  ): Promise<void> {
    await this.sql`
      INSERT INTO config_revision (id, tenant_id, domain, config_key, summary, author, payload)
      VALUES (${randomUUID()}, ${tenantId}, ${domain}, ${configKey}, ${summary}, ${author},
              ${this.sql.json((previous ?? null) as never)})`;
  }

  async createIntegration(
    tenantId: string,
    input: { source: string; intake: Intake; envelopeVersion: string },
    author: string,
  ): Promise<{ integration: Integration; secret: string; createdAt: string }> {
    const existing = await this.sql`
      SELECT 1 FROM config_origin WHERE tenant_id = ${tenantId} AND source = ${input.source}`;
    if (existing.length > 0) {
      throw new ConfigConflictError(`integration ${input.source} already exists`);
    }

    const { secret, createdAt } = await this.writeSecret(tenantId, input.source);

    await this.sql`
      INSERT INTO config_origin (tenant_id, source, intake, envelope_version, enabled, secret_created_at)
      VALUES (${tenantId}, ${input.source}, ${input.intake}, ${input.envelopeVersion}, TRUE,
              ${createdAt})`;
    await this.sql`
      INSERT INTO config_dictionary_version (tenant_id, source, version, status)
      VALUES (${tenantId}, ${input.source}, 'v1', 'draft')`;

    await this.recordRevision(
      tenantId,
      'origin',
      input.source,
      `Integração ${input.source} criada`,
      author,
      input,
    );
    await this.publishOrigin(tenantId, input.source);
    await this.publishDictionary(tenantId, input.source);

    return {
      integration: await this.getIntegration(tenantId, input.source),
      secret,
      createdAt: createdAt.toISOString(),
    };
  }

  /**
   * Mints the origin's signing key. Returned once to the caller and never
   * readable again — the store keeps only when it was created.
   */
  private async writeSecret(
    tenantId: string,
    source: string,
  ): Promise<{ secret: string; createdAt: Date }> {
    const secret = randomBytes(32).toString('base64url');
    await this.secrets.writeOriginSecret(tenantId, source, secret);
    return { secret, createdAt: new Date() };
  }

  async rotateSecret(
    tenantId: string,
    source: string,
    author: string,
  ): Promise<{ secret: string; createdAt: string }> {
    await this.getIntegration(tenantId, source);
    const { secret, createdAt } = await this.writeSecret(tenantId, source);

    await this.sql`
      UPDATE config_origin SET secret_created_at = ${createdAt}, updated_at = now()
       WHERE tenant_id = ${tenantId} AND source = ${source}`;
    await this.recordRevision(
      tenantId,
      'origin',
      source,
      `Chave de ${source} rotacionada`,
      author,
      { source },
    );

    return { secret, createdAt: createdAt.toISOString() };
  }

  async updateBindings(
    tenantId: string,
    source: string,
    bindings: readonly { field: string; path: string | null }[],
    author: string,
  ): Promise<Integration> {
    const previous = await this.getIntegration(tenantId, source);

    await this.sql.begin(async tx => {
      await tx`DELETE FROM config_field_binding
                WHERE tenant_id = ${tenantId} AND source = ${source}`;
      if (bindings.length > 0) {
        await tx`INSERT INTO config_field_binding ${tx(
          bindings.map(binding => ({
            tenant_id: tenantId,
            source,
            field: binding.field,
            path: binding.path,
          })),
          'tenant_id',
          'source',
          'field',
          'path',
        )}`;
      }
    });

    await this.recordRevision(
      tenantId,
      'origin',
      source,
      `Campos de ${source} atualizados`,
      author,
      previous.bindings,
    );
    await this.publishOrigin(tenantId, source);
    return await this.getIntegration(tenantId, source);
  }

  async upsertMapping(
    tenantId: string,
    source: string,
    input: { field: MappingField; from: string; to: string },
    author: string,
  ): Promise<Integration> {
    await this.getIntegration(tenantId, source);

    await this.sql`
      INSERT INTO config_mapping (id, tenant_id, source, mapping_field, from_value, to_value)
      VALUES (${randomUUID()}, ${tenantId}, ${source}, ${input.field}, ${input.from}, ${input.to})
      ON CONFLICT (tenant_id, source, mapping_field, from_value)
      DO UPDATE SET to_value = EXCLUDED.to_value`;

    await this.recordRevision(
      tenantId,
      'dictionary',
      source,
      `${input.from} → ${input.to} em ${input.field}`,
      author,
      input,
    );
    await this.publishDictionary(tenantId, source);
    return await this.getIntegration(tenantId, source);
  }

  async removeMapping(
    tenantId: string,
    source: string,
    mappingId: string,
    author: string,
  ): Promise<Integration> {
    const removed = await this.sql<{ mapping_field: string; from_value: string }[]>`
      DELETE FROM config_mapping
       WHERE id = ${mappingId} AND tenant_id = ${tenantId} AND source = ${source}
      RETURNING mapping_field, from_value`;
    const entry = removed[0];
    if (!entry) throw new ConfigNotFoundError(`mapping ${mappingId} not found`);

    await this.recordRevision(
      tenantId,
      'dictionary',
      source,
      `${entry.from_value} removido de ${entry.mapping_field}`,
      author,
      { mappingId },
    );
    await this.publishDictionary(tenantId, source);
    return await this.getIntegration(tenantId, source);
  }

  async replaceDeadlines(
    tenantId: string,
    items: readonly Deadline[],
    author: string,
  ): Promise<Deadline[]> {
    const previous = await this.listDeadlines(tenantId);

    await this.sql.begin(async tx => {
      await tx`DELETE FROM config_deadline WHERE tenant_id = ${tenantId}`;
      if (items.length > 0) {
        await tx`INSERT INTO config_deadline ${tx(
          items.map(item => ({
            tenant_id: tenantId,
            severity: item.severity,
            deadline_seconds: item.deadlineSeconds,
          })),
          'tenant_id',
          'severity',
          'deadline_seconds',
        )}`;
      }
    });

    await this.recordRevision(
      tenantId,
      'deadline',
      tenantId,
      'Prazos atualizados',
      author,
      previous,
    );
    await this.publishDeadlines(tenantId);
    return await this.listDeadlines(tenantId);
  }

  async replaceKpiTargets(
    tenantId: string,
    items: readonly KpiTarget[],
    author: string,
  ): Promise<KpiTarget[]> {
    const previous = await this.listKpiTargets(tenantId);

    await this.sql.begin(async tx => {
      await tx`DELETE FROM config_kpi_target WHERE tenant_id = ${tenantId}`;
      if (items.length > 0) {
        await tx`INSERT INTO config_kpi_target ${tx(
          items.map(item => ({
            tenant_id: tenantId,
            kpi_group: item.kpiGroup,
            max_breaches: item.maxBreaches,
            achievement_pct: item.achievementPct,
          })),
          'tenant_id',
          'kpi_group',
          'max_breaches',
          'achievement_pct',
        )}`;
      }
    });

    await this.recordRevision(
      tenantId,
      'kpi_target',
      tenantId,
      'Metas atualizadas',
      author,
      previous,
    );
    await this.publishKpiTargets(tenantId);
    return await this.listKpiTargets(tenantId);
  }

  /**
   * Restores the state a revision recorded and records the restore as its own
   * revision — the history only grows, so a rollback is itself revertible.
   */
  async rollback(tenantId: string, revisionId: string, author: string): Promise<void> {
    const rows = await this.sql<
      { domain: ConfigDomain; config_key: string; payload: unknown; summary: string }[]
    >`
      SELECT domain, config_key, payload, summary FROM config_revision
       WHERE id = ${revisionId} AND tenant_id = ${tenantId}`;
    const revision = rows[0];
    if (!revision) throw new ConfigNotFoundError(`revision ${revisionId} not found`);
    if (revision.payload === null) {
      throw new ConfigConflictError(`revision ${revisionId} has no prior state to restore`);
    }

    switch (revision.domain) {
      case 'deadline':
        await this.replaceDeadlines(tenantId, revision.payload as Deadline[], author);
        return;
      case 'kpi_target':
        await this.replaceKpiTargets(tenantId, revision.payload as KpiTarget[], author);
        return;
      case 'origin':
        await this.updateBindings(
          tenantId,
          revision.config_key,
          revision.payload as { field: string; path: string | null }[],
          author,
        );
        return;
      default:
        throw new ConfigConflictError(`rollback of ${revision.domain} is not supported yet`);
    }
  }

  /** Republishes every domain — what a consumer needs after the topics are
      recreated, and what the seed script calls. */
  async republishAll(tenantId: string): Promise<void> {
    const integrations = await this.listIntegrations(tenantId);
    for (const integration of integrations) {
      await this.publishOrigin(tenantId, integration.source);
      await this.publishDictionary(tenantId, integration.source);
    }
    await this.publishDeadlines(tenantId);
    await this.publishKpiTargets(tenantId);
  }
}
