/**
 * Every credential the gateway accepts. One entry per (tenant, source): the
 * route identifies the source system, the secret registered here identifies
 * the tenant — an attacker cannot claim a tenant without that tenant's
 * secret, so tenant_id in the envelope is authoritative from the signature
 * check, never from the URL or the payload (domain/ubiquitous-language.md#tenant).
 *
 * Adding an origin, or a new tenant on an existing origin, is adding an
 * entry here — nothing downstream of the raw envelope changes
 * (domain/acl/itsm.md#adicionar-uma-origem).
 */
export interface OriginCredential {
  tenantId: string;
  source: string;
  intake: 'alert' | 'monitor';
  envelopeVersion: string;
  /** Name of the env var carrying this credential's HMAC secret. */
  hmacSecretEnv: string;
}

export const ORIGIN_CREDENTIALS: readonly OriginCredential[] = [
  {
    tenantId: 'locaweb',
    source: 'itsm',
    intake: 'alert',
    envelopeVersion: 'v1',
    hmacSecretEnv: 'HMAC_SECRET_LOCAWEB_ITSM',
  },
];

export function routePath(credential: OriginCredential): string {
  return `/webhook/${credential.envelopeVersion}/${credential.tenantId}/${credential.source}`;
}
