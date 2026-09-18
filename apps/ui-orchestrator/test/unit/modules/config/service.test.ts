import { describe, expect, it } from 'vitest';
import {
  ConfigNotFoundError,
  ConfigService,
  type EventPublisher,
  originTopicKey,
} from '../../../../src/modules/config/service.ts';
import type { SecretStore } from '../../../../src/modules/config/vault.ts';

const TOPICS = {
  origin: 'config.origin',
  dictionary: 'config.dictionary',
  deadline: 'config.deadline',
  kpiTarget: 'config.kpi-target',
};

type Published = { topic: string; key: string; value: string };

function recordingPublisher(): { publisher: EventPublisher; published: Published[] } {
  const published: Published[] = [];
  return {
    published,
    publisher: {
      async publish(topic, message) {
        published.push({ topic, ...message });
      },
    },
  };
}

const secrets: SecretStore = { writeOriginSecret: async () => undefined };

/**
 * Answers each tagged-template query by matching the SQL text, so the service
 * runs its real query sequence without a database.
 */
function fakeSql(responses: { match: RegExp; rows: unknown[] }[]) {
  const sql = (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    const found = responses.find(response => response.match.test(text));
    return Promise.resolve(found?.rows ?? []);
  };
  return sql as never;
}

describe('originTopicKey', () => {
  it('keys an origin by tenant and source, so compaction keeps one per origin', () => {
    expect(originTopicKey('locaweb', 'itsm')).toBe('locaweb:itsm');
  });
});

describe('listIntegrations', () => {
  it('embeds bindings and mappings, so one integration is one call', async () => {
    const service = new ConfigService(
      fakeSql([
        {
          match: /FROM config_origin/,
          rows: [
            {
              source: 'itsm',
              intake: 'alert',
              envelope_version: 'v1',
              secret_created_at: new Date('2026-01-01T00:00:00Z'),
              enabled: true,
              dictionary_version: 'v1',
              dictionary_status: 'published',
            },
          ],
        },
        {
          match: /FROM config_field_binding/,
          rows: [{ source: 'itsm', field: 'external_id', path: 'ticket_number' }],
        },
        {
          match: /FROM config_mapping/,
          rows: [
            {
              source: 'itsm',
              id: '11111111-1111-4111-8111-111111111111',
              mapping_field: 'status',
              from_value: 'Encerrado',
              to_value: 'closed',
            },
            {
              source: 'itsm',
              id: '22222222-2222-4222-8222-222222222222',
              mapping_field: 'status',
              from_value: 'Sem Intervenção',
              to_value: 'closed',
            },
          ],
        },
      ]),
      recordingPublisher().publisher,
      TOPICS,
      secrets,
    );

    const [integration] = await service.listIntegrations('locaweb');

    expect(integration?.bindings).toEqual([{ field: 'external_id', path: 'ticket_number' }]);
    // Several origin values may land on the same domain value, never the reverse.
    expect(integration?.mappings.status).toHaveLength(2);
    expect(integration?.mappings.status?.map(entry => entry.to)).toEqual(['closed', 'closed']);
  });
});

describe('getIntegration', () => {
  it('rejects an unknown source rather than answering an empty integration', async () => {
    const service = new ConfigService(fakeSql([]), recordingPublisher().publisher, TOPICS, secrets);

    await expect(service.getIntegration('locaweb', 'zabbix')).rejects.toBeInstanceOf(
      ConfigNotFoundError,
    );
  });
});

describe('replaceDeadlines', () => {
  it('publishes the whole tenant state, so a consumer rehydrates from one record', async () => {
    const { publisher, published } = recordingPublisher();
    const rows = [
      { severity: 1, deadline_seconds: 14400 },
      { severity: 3, deadline_seconds: 43200 },
    ];
    const sql = (strings: TemplateStringsArray) =>
      Promise.resolve(/FROM config_deadline/.test(strings.join(' ')) ? rows : []);
    Object.assign(sql, {
      begin: async (fn: (tx: unknown) => Promise<void>) => {
        await fn(sql);
      },
      json: (value: unknown) => value,
    });

    const service = new ConfigService(sql as never, publisher, TOPICS, secrets);
    await service.replaceDeadlines(
      'locaweb',
      [
        { severity: 1, deadlineSeconds: 14400 },
        { severity: 3, deadlineSeconds: 43200 },
      ],
      'anonymous',
    );

    const message = published.find(entry => entry.topic === 'config.deadline');
    expect(message?.key).toBe('locaweb');
    expect(JSON.parse(message?.value ?? '{}')).toEqual({
      tenant_id: 'locaweb',
      deadlines: [
        { severity: 1, deadline_seconds: 14400 },
        { severity: 3, deadline_seconds: 43200 },
      ],
    });
  });
});
