import { describe, expect, it } from 'vitest';
import { buildEnvelope } from '../../../../src/modules/events/service.ts';
import type { OriginCredential } from '../../../../src/plugins/origin-registry.ts';

const ITSM_CREDENTIAL: OriginCredential = {
  tenantId: 'locaweb',
  source: 'itsm',
  intake: 'alert',
  envelopeVersion: 'v1',
  hmacSecretEnv: 'HMAC_SECRET_LOCAWEB_ITSM',
};

// One row of assets/incidents.csv, as scripts/incident_producer.py posts it.
const itsmBody = {
  ticket_number: 'INC0012345',
  opened_at: '2025-12-31 23:45:18',
  priority_code: 2,
  configuration_item: 'srv-web-04',
  status: 'Encerrado',
  opened_by: 'Monitoramento',
};

describe('buildEnvelope', () => {
  it('assigns identity, tenant, source, and intake from the credential — nothing from the body', () => {
    const envelope = buildEnvelope(ITSM_CREDENTIAL, itsmBody);

    expect(envelope).toMatchObject({
      tenant_id: 'locaweb',
      source: 'itsm',
      intake: 'alert',
      version: 'v1',
    });
  });

  it('keeps the origin body verbatim, opaque, in payload', () => {
    const envelope = buildEnvelope(ITSM_CREDENTIAL, itsmBody);

    expect(JSON.parse(envelope.payload)).toEqual(itsmBody);
  });

  it('is not influenced by a body that tries to declare its own source or tenant', () => {
    const envelope = buildEnvelope(ITSM_CREDENTIAL, {
      ...itsmBody,
      source: 'datadog',
      tenant_id: 'someone-else',
      intake: 'monitor',
    });

    expect(envelope).toMatchObject({ tenant_id: 'locaweb', source: 'itsm', intake: 'alert' });
  });

  it('gives every event its own id', () => {
    expect(buildEnvelope(ITSM_CREDENTIAL, itsmBody).event_id).not.toBe(
      buildEnvelope(ITSM_CREDENTIAL, itsmBody).event_id,
    );
  });
});
