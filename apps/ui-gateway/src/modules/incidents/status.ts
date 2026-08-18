import { z } from 'zod';

/**
 * The ITSM's own status words, mapped onto the Ubiquitous Language. This is the
 * ACL's dictionary for the field (domain/acl/itsm.md) — the only place in the
 * system where the origin's vocabulary is read.
 */
const ITSM_STATUS: Record<string, IncidentStatus> = {
  'Sem Intervenção': 'no_intervention',
  'Encerrado Automaticamente': 'auto_closed',
  Encerrado: 'closed',
  'Aguardando Problema': 'awaiting_problem',
};

export const incidentStatusSchema = z
  .enum(['no_intervention', 'auto_closed', 'closed', 'awaiting_problem', 'unknown'])
  .meta({ id: 'IncidentStatus', description: 'Incident status in the Ubiquitous Language' });

export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

/**
 * A status the dictionary does not know becomes `unknown` rather than failing
 * the event: the origin may add one at any time, and the verbatim value stays
 * in payload_raw for whoever needs to extend the map.
 */
export function toIncidentStatus(raw: string): IncidentStatus {
  return ITSM_STATUS[raw.trim()] ?? 'unknown';
}
