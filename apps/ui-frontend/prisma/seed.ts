import { PrismaClient } from '@prisma/client';

/**
 * Bootstrap of the configuration registry. Idempotent: re-running it leaves
 * whatever the customer has since changed.
 */

const prisma = new PrismaClient();

const TENANT_SLUG = 'locaweb';
const TENANT_NAME = 'Locaweb';
const SOURCE = 'service_now';
const INTAKE = 'monitor';

/** Where each field of the Monitor contract is read in ServiceNow's payload. */
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

/** ServiceNow vocabulary, as apps/data-ingest/dictionaries once carried it. */
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

const KPI_TARGETS: [severities: number[], maxBreaches: number, achievementPct: number][] = [
  [[1, 2], 30, 150],
  [[1, 2], 35, 125],
  [[1, 2], 39, 100],
  [[1, 2], 45, 75],
  [[1, 2], 53, 50],
  [[1, 2], 999999, 0],
  [[3], 200, 150],
  [[3], 230, 125],
  [[3], 263, 100],
  [[3], 290, 75],
  [[3], 320, 50],
  [[3], 999999, 0],
];

async function main(): Promise<void> {
  await prisma.tenant.updateMany({
    where: { slug: { not: TENANT_SLUG }, status: 'active' },
    data: { status: 'inactive' },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT_SLUG },
    update: { name: TENANT_NAME, status: 'active' },
    create: { slug: TENANT_SLUG, name: TENANT_NAME, status: 'active' },
  });

  const origin = await prisma.origin.upsert({
    where: { tenantId_source: { tenantId: tenant.id, source: SOURCE } },
    update: { intake: INTAKE },
    create: {
      tenantId: tenant.id,
      source: SOURCE,
      intake: INTAKE,
      envelopeVersion: 'v1',
      status: 'active',
      secretCreatedAt: new Date(),
      dictionary: { create: { version: 'v1', status: 'active' } },
    },
  });

  for (const [field, path] of BINDINGS) {
    await prisma.fieldBinding.upsert({
      where: { originId_field: { originId: origin.id, field } },
      update: {},
      create: { originId: origin.id, field, path },
    });
  }

  for (const [mappingField, pairs] of Object.entries(MAPPINGS)) {
    for (const [fromValue, toValue] of Object.entries(pairs)) {
      await prisma.mapping.upsert({
        where: {
          originId_mappingField_fromValue: {
            originId: origin.id,
            mappingField,
            fromValue,
          },
        },
        update: {},
        create: { originId: origin.id, mappingField, fromValue, toValue },
      });
    }
  }

  for (const [severity, deadlineSeconds] of DEADLINES) {
    await prisma.deadline.upsert({
      where: { tenantId_severity: { tenantId: tenant.id, severity } },
      update: {},
      create: { tenantId: tenant.id, severity, deadlineSeconds },
    });
  }

  for (const [severities, maxBreaches, achievementPct] of KPI_TARGETS) {
    await prisma.kpiTarget.upsert({
      where: {
        tenantId_severities_achievementPct: {
          tenantId: tenant.id,
          severities,
          achievementPct,
        },
      },
      update: {},
      create: { tenantId: tenant.id, severities, maxBreaches, achievementPct },
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
