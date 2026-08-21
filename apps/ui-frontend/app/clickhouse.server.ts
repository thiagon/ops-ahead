import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { getConfig } from './config.server.ts';

/**
 * One row per tenant_id × as_of_date × kpi_group, written by ml-trainer's
 * kpi_projection analysis.
 */
export interface KpiProjectionRow {
  tenant_id: string;
  as_of_date: string;
  kpi_group: string;
  median_breaches_ytd: number;
  ci80_lower: number;
  ci80_upper: number;
  p_within_target: number | null;
}

/** One row per target_date × priority_group × horizon (D+1 and D+7). */
export interface VolumeForecastRow {
  target_date: string;
  priority_group: string;
  horizon: number;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

let cached: ClickHouseClient | undefined;

/**
 * The `@clickhouse/client` package resolves to the Node build; importing it
 * from a module the browser could reach would fail at bundle time. The
 * `.server.ts` suffix keeps that import — and the credentials in
 * CLICKHOUSE_URL — inside the server bundle only.
 */
export function getClickHouseClient(): ClickHouseClient {
  cached ??= createClient({ url: getConfig().CLICKHOUSE_URL });
  return cached;
}

async function query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await getClickHouseClient().query({
    query: sql,
    query_params: params,
    format: 'JSONEachRow',
  });
  return await result.json<T>();
}

export async function fetchKpiProjection(asOfLimit = 1): Promise<KpiProjectionRow[]> {
  return await query<KpiProjectionRow>(
    `select tenant_id, toString(as_of_date) as as_of_date, kpi_group,
            median_breaches_ytd, ci80_lower, ci80_upper, p_within_target
     from gold_kpi_projection
     where tenant_id = {tenant_id:String}
     order by as_of_date desc, kpi_group
     limit {limit:UInt32} by kpi_group`,
    { tenant_id: getConfig().TENANT_ID, limit: asOfLimit },
  );
}

// gold_volume_forecast carries no tenant_id — ml-trainer writes it per run,
// not per tenant.
export async function fetchVolumeForecast(): Promise<VolumeForecastRow[]> {
  return await query<VolumeForecastRow>(
    `select toString(target_date) as target_date, priority_group, horizon,
            yhat, yhat_lower, yhat_upper
     from gold_volume_forecast
     order by target_date desc, priority_group, horizon
     limit 1 by priority_group, horizon`,
    {},
  );
}
