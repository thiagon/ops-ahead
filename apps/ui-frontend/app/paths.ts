import { useParams } from 'react-router';

/** Client-safe URL builders. Path segments are English; the screens speak Portuguese. */

export function panelPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}`;
}

export function managerPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/manager`;
}

export function queuePath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/queue`;
}

export function integrationsPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/integrations`;
}

export function integrationPath(tenant: string, source: string): string {
  return `${integrationsPath(tenant)}/${encodeURIComponent(source)}`;
}

export function targetsPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/targets`;
}

export function deadlinesPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/deadlines`;
}

export function analysesPath(tenant: string): string {
  return `/${encodeURIComponent(tenant)}/analyses`;
}

export function occurrencePath(tenant: string, source: string, externalId: string): string {
  return `/${encodeURIComponent(tenant)}/occurrences/${encodeURIComponent(source)}/${encodeURIComponent(externalId)}`;
}

export function occurrenceDetailPath(tenant: string, source: string, externalId: string): string {
  return `${occurrencePath(tenant, source, externalId)}/detail`;
}

/** Screens under `/:tenant` always have the param; missing it is a routing bug. */
export function useTenantSlug(): string {
  const tenant = useParams().tenant;
  if (!tenant) {
    throw new Error('This screen is only reachable under a tenant URL.');
  }
  return tenant;
}
