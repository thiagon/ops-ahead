import { PrismaClient } from '@prisma/client';

/**
 * The state the pipeline runs on today, as it lived in the files next to each
 * consumer before these screens existed. Idempotent: re-running it leaves the
 * registry as it finds it, so a redeploy never duplicates or overwrites what
 * the customer has since changed.
 */

const prisma = new PrismaClient();

const TENANT = 'locaweb';
const SOURCE = 'itsm';

/** Where each field of incident-alert is read in the ITSM's own payload. */
const BINDINGS: [field: string, path: string | null][] = [
  ['external_id', 'ticket_number'],
  ['opened_at', 'opened_at'],
  ['acknowledged_at', null],
  ['resolved_at', 'resolved_at'],
  ['closed_at', 'closed_at'],
  ['severity', 'priority_code'],
  ['status', 'status'],
  ['entity_id', 'configuration_item'],
  ['title', 'short_description'],
  ['description', null],
  ['owner', 'assignment_group'],
  ['reported_by', 'opened_by'],
  ['parent_id', 'parent_incident'],
  ['resolution_code', 'status'],
  ['resolution_summary', 'resolution'],
  ['labels', null],
  ['source_url', null],
];

/** The ITSM's own vocabulary, as apps/data-ingest/dictionaries once carried it. */
const MAPPINGS: Record<string, Record<string, string>> = {
  status: {
    'Aguardando Problema': 'waiting',
    Encerrado: 'closed',
    'Encerrado Automaticamente': 'closed',
    'Sem Intervenção': 'closed',
  },
  reported_by: {
    Monitoramento: 'automatic',
    Manual: 'manual',
  },
  resolution_code: {
    'Sem Intervenção': 'no_intervention',
    'Encerrado Automaticamente': 'auto_resolved',
  },
};

const DEADLINES: [severity: number, seconds: number][] = [
  [1, 14400],
  [2, 14400],
  [3, 43200],
  [4, 86400],
  [5, 345600],
];

const KPI_TARGETS: [group: string, maxBreaches: number, achievementPct: number][] = [
  ['p1_p2', 30, 150],
  ['p1_p2', 35, 125],
  ['p1_p2', 39, 100],
  ['p1_p2', 45, 75],
  ['p1_p2', 53, 50],
  ['p1_p2', 999999, 0],
  ['p3', 200, 150],
  ['p3', 230, 125],
  ['p3', 263, 100],
  ['p3', 290, 75],
  ['p3', 320, 50],
  ['p3', 999999, 0],
];

async function main(): Promise<void> {
  await prisma.origin.upsert({
    where: { tenantId_source: { tenantId: TENANT, source: SOURCE } },
    update: {},
    create: {
      tenantId: TENANT,
      source: SOURCE,
      intake: 'alert',
      envelopeVersion: 'v1',
      enabled: true,
      secretCreatedAt: new Date(),
      dictionary: { create: { version: 'v1', status: 'published' } },
    },
  });

  for (const [field, path] of BINDINGS) {
    await prisma.fieldBinding.upsert({
      where: { tenantId_source_field: { tenantId: TENANT, source: SOURCE, field } },
      update: {},
      create: { tenantId: TENANT, source: SOURCE, field, path },
    });
  }

  for (const [mappingField, pairs] of Object.entries(MAPPINGS)) {
    for (const [fromValue, toValue] of Object.entries(pairs)) {
      await prisma.mapping.upsert({
        where: {
          tenantId_source_mappingField_fromValue: {
            tenantId: TENANT,
            source: SOURCE,
            mappingField,
            fromValue,
          },
        },
        update: {},
        create: {
          id: crypto.randomUUID(),
          tenantId: TENANT,
          source: SOURCE,
          mappingField,
          fromValue,
          toValue,
        },
      });
    }
  }

  for (const [severity, deadlineSeconds] of DEADLINES) {
    await prisma.deadline.upsert({
      where: { tenantId_severity: { tenantId: TENANT, severity } },
      update: {},
      create: { tenantId: TENANT, severity, deadlineSeconds },
    });
  }

  for (const [kpiGroup, maxBreaches, achievementPct] of KPI_TARGETS) {
    await prisma.kpiTarget.upsert({
      where: {
        tenantId_kpiGroup_achievementPct: { tenantId: TENANT, kpiGroup, achievementPct },
      },
      update: {},
      create: { tenantId: TENANT, kpiGroup, maxBreaches, achievementPct },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    await prisma.$disconnect();
    console.error(error);
    process.exit(1);
  });
