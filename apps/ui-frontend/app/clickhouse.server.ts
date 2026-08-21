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

/**
 * One still-open occurrence, from the `silver_alert_open` view. `due_at` and
 * `consumed_ratio` are the deadline vigente — recomputed from the current
 * severity on every recategorization, never continued from the original one.
 */
export interface OpenAlertRow {
  tenant_id: string;
  source: string;
  external_id: string;
  severity: number;
  status: string;
  entity_id: string | null;
  title: string;
  owner: string;
  reported_by: string;
  opened_at: string;
  acknowledged_at: string | null;
  due_at: string;
  deadline_seconds: number;
  consumed_ratio: number | null;
  // ClickHouse renders UInt8 booleans as 0/1 over JSONEachRow.
  has_breached: number;
  is_eligible: number;
  severity_changes: number;
}

/** A deadline milestone this occurrence already crossed. */
export interface MilestoneRow {
  kind: string;
  severity: number;
  due_at: string;
  deadline_seconds: number;
  consumed_ratio: number;
  occurred_at: string;
}

/** One severity transition, from `priority_changes_log`. */
export interface SeverityChangeRow {
  received_at: string;
  severity_from: number;
  severity_to: number;
}

/**
 * The context the breach model needs that lives outside `silver_alert_open`:
 * owner load, the entity's monitor-chain activity, and how far past the
 * deadline this owner + severity combination has historically run.
 */
export interface BreachContextRow {
  owner: string;
  severity: number;
  group_load: number;
  entity_id: string | null;
  entity_signal_count_15m: number;
  entity_signal_count_1h: number;
  entity_auto_resolution_rate: number | null;
  entity_severity_escalations: number;
  group_severity_historical_ola_ratio: number | null;
  group_severity_historical_over_25pct_rate: number | null;
  no_intervention_count_1h: number;
  no_intervention_count_6h: number;
  p4_precursor_length: number;
}

/** One row per year × month × kpi_group, cumulative against the annual band. */
export interface KpiAchievementRow {
  year: number;
  month: string;
  kpi_group: string;
  breached_ytd: number;
  achievement_pct: number;
}

/** One row per date × category × product, severities never collapsed. */
export interface CategoryTrendRow {
  date: string;
  category: string;
  product: string;
  total_incidents: number;
  p1_count: number;
  p2_count: number;
  p3_count: number;
  p4_count: number;
  p5_count: number;
  avg_duration_seconds: number;
}

/** Current load per owner group, from the latest group_load_by_window snapshot. */
export interface GroupLoadRow {
  owner: string;
  snapshot_at: string;
  incidents_open: number;
}

/** An entity's signal volume over the last hour, from gold_monitor_signal_counts. */
export interface NoisyEntityRow {
  entity_id: string;
  window_minutes: number;
  signal_count: number;
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

export async function query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
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

export const OPEN_ALERT_COLUMNS = `tenant_id, source, external_id, severity, status, entity_id, title,
            owner, reported_by,
            toString(opened_at) as opened_at,
            toString(acknowledged_at) as acknowledged_at,
            toString(due_at) as due_at,
            deadline_seconds, consumed_ratio,
            toUInt8(has_breached) as has_breached,
            toUInt8(is_eligible) as is_eligible,
            severity_changes`;

export const OPEN_ALERTS_SQL = `select ${OPEN_ALERT_COLUMNS}
     from silver_alert_open
     where tenant_id = {tenant_id:String}
     order by due_at asc
     limit {limit:UInt32}`;

export async function fetchKpiAchievement(monthsBack = 12): Promise<KpiAchievementRow[]> {
  return await query<KpiAchievementRow>(
    // toString(month) aliased back to "month" makes ClickHouse's optimizer
    // resolve the WHERE clause against the String alias instead of the
    // underlying Date column ("no supertype for String, Date"). Filtering
    // and ordering in an inner scope, before the rename, avoids the clash.
    `select year, toString(month) as month, kpi_group, breached_ytd, achievement_pct
     from (
       select year, month, kpi_group, breached_ytd, achievement_pct
       from gold_alert_kpi_achievement
       where tenant_id = {tenant_id:String}
         and month >= toStartOfMonth(now()) - toIntervalMonth({months_back:UInt32})
       order by month asc, kpi_group
     )`,
    { tenant_id: getConfig().TENANT_ID, months_back: monthsBack },
  );
}

export async function fetchCategoryTrends(daysBack = 30): Promise<CategoryTrendRow[]> {
  return await query<CategoryTrendRow>(
    // Same alias-vs-column clash as fetchKpiAchievement — filter/order on
    // date before renaming it to a String.
    `select toString(date) as date, category, product, total_incidents,
            p1_count, p2_count, p3_count, p4_count, p5_count, avg_duration_seconds
     from (
       select date, category, product, total_incidents,
              p1_count, p2_count, p3_count, p4_count, p5_count, avg_duration_seconds
       from gold_alert_category_trends
       where date >= today() - {days_back:UInt32}
       order by date desc, total_incidents desc
     )`,
    { days_back: daysBack },
  );
}

export async function fetchGroupLoad(): Promise<GroupLoadRow[]> {
  return await query<GroupLoadRow>(
    `select owner, toString(snapshot_at) as snapshot_at, incidents_open
     from group_load_by_window
     order by owner
     limit 1 by owner`,
    {},
  );
}

/**
 * The busiest entities over the last hour — a proxy for "recurso ruidoso"
 * ahead of any incident actually opening on it.
 */
export async function fetchNoisyEntities(limit = 10): Promise<NoisyEntityRow[]> {
  return await query<NoisyEntityRow>(
    `select entity_id, window_minutes, signal_count
     from gold_monitor_signal_counts
     where window_minutes = 60
     order by window_start desc, signal_count desc
     limit 1 by entity_id
     limit {limit:UInt32}`,
    { limit },
  );
}

export async function fetchOpenAlerts(limit = 200): Promise<OpenAlertRow[]> {
  return await query<OpenAlertRow>(OPEN_ALERTS_SQL, {
    tenant_id: getConfig().TENANT_ID,
    limit,
  });
}

export async function fetchOpenAlert(
  source: string,
  externalId: string,
): Promise<OpenAlertRow | undefined> {
  const rows = await query<OpenAlertRow>(
    `select ${OPEN_ALERT_COLUMNS}
     from silver_alert_open
     where tenant_id = {tenant_id:String}
       and source = {source:String}
       and external_id = {external_id:String}
     limit 1`,
    { tenant_id: getConfig().TENANT_ID, source, external_id: externalId },
  );
  return rows[0];
}

/**
 * The milestones the tracker actually emitted for this occurrence
 * (`contracts/deadline-milestone.schema.json`), not thresholds re-derived
 * from the current consumed_ratio: a recategorization restarts the marcos on
 * the new deadline, so which ones were crossed is only knowable from what was
 * published at the time.
 */
export async function fetchMilestones(source: string, externalId: string): Promise<MilestoneRow[]> {
  return await query<MilestoneRow>(
    `select kind, severity,
            toString(due_at) as due_at,
            deadline_seconds, consumed_ratio,
            toString(occurred_at) as occurred_at
     from bronze_deadline_milestone
     where tenant_id = {tenant_id:String}
       and source = {source:String}
       and external_id = {external_id:String}
     order by occurred_at asc`,
    { tenant_id: getConfig().TENANT_ID, source, external_id: externalId },
  );
}

export async function fetchSeverityHistory(
  source: string,
  externalId: string,
): Promise<SeverityChangeRow[]> {
  return await query<SeverityChangeRow>(
    `select toString(received_at) as received_at, severity_from, severity_to
     from priority_changes_log
     where tenant_id = {tenant_id:String}
       and source = {source:String}
       and external_id = {external_id:String}
     order by received_at asc`,
    { tenant_id: getConfig().TENANT_ID, source, external_id: externalId },
  );
}

/**
 * Breach-model context for every currently open occurrence, in one query keyed
 * by `source external_id` — the alternative is several extra round trips per
 * queue row.
 */
export async function fetchBreachContext(): Promise<Record<string, BreachContextRow>> {
  const rows = await query<BreachContextRow & { source: string; external_id: string }>(
    `with open_alerts as (
         select tenant_id, source, external_id, entity_id, owner, severity, opened_at
         from silver_alert_open
         where tenant_id = {tenant_id:String}
     ),
     -- group_load_by_window is rewritten on every dbt run; only the latest
     -- snapshot describes the queue as it stands now.
     owner_load as (
         select owner, argMax(incidents_open, snapshot_at) as incidents_open
         from group_load_by_window
         group by owner
     ),
     signals as (
         select entity_id, window_minutes, argMax(signal_count, window_start) as signal_count
         from gold_monitor_signal_counts
         where window_minutes in (15, 60)
         group by entity_id, window_minutes
     ),
     escalations as (
         select entity_id, sum(escalation_count) as escalation_count
         from gold_monitor_severity_escalations
         group by entity_id
     ),
     -- Owner + severity history over closed occurrences only: an open one has
     -- no final duration to compare against its deadline yet.
     history as (
         select owner, severity,
                avg(duration_seconds / nullIf(deadline_seconds, 0))             as ola_ratio,
                avgIf(1, duration_seconds / nullIf(deadline_seconds, 0) > 0.25) as over_25pct_rate
         from gold_alert_breach_consolidation
         where tenant_id = {tenant_id:String}
         group by owner, severity
     ),
     precursor as (
         select o.source as source, o.external_id as external_id,
                countIf(s.closed_at >= now() - toIntervalHour(1))  as count_1h,
                countIf(s.closed_at >= now() - toIntervalHour(6))  as count_6h,
                countIf(s.closed_at >= now() - toIntervalHour(24)) as precursor_length
         from open_alerts o
         inner join silver_alert s on s.entity_id = o.entity_id
         where s.resolution_code = 'no_intervention'
           and s.closed_at is not null
           and not (s.source = o.source and s.external_id = o.external_id)
         group by o.source, o.external_id
     )
     select o.source                                  as source,
            o.external_id                             as external_id,
            o.owner                                   as owner,
            o.severity                                as severity,
            o.entity_id                               as entity_id,
            toUInt32(coalesce(l.incidents_open, 0))   as group_load,
            toUInt32(coalesce(s15.signal_count, 0))   as entity_signal_count_15m,
            toUInt32(coalesce(s60.signal_count, 0))   as entity_signal_count_1h,
            r.auto_resolution_rate                    as entity_auto_resolution_rate,
            toUInt32(coalesce(e.escalation_count, 0)) as entity_severity_escalations,
            h.ola_ratio                               as group_severity_historical_ola_ratio,
            h.over_25pct_rate                         as group_severity_historical_over_25pct_rate,
            toUInt32(coalesce(p.count_1h, 0))         as no_intervention_count_1h,
            toUInt32(coalesce(p.count_6h, 0))         as no_intervention_count_6h,
            toUInt32(coalesce(p.precursor_length, 0)) as p4_precursor_length
     from open_alerts o
     left join owner_load l on l.owner = o.owner
     left join signals s15 on s15.entity_id = o.entity_id and s15.window_minutes = 15
     left join signals s60 on s60.entity_id = o.entity_id and s60.window_minutes = 60
     left join gold_monitor_auto_resolution_rate r on r.entity_id = o.entity_id
     left join escalations e on e.entity_id = o.entity_id
     left join history h on h.owner = o.owner and h.severity = o.severity
     left join precursor p on p.source = o.source and p.external_id = o.external_id`,
    { tenant_id: getConfig().TENANT_ID },
  );

  return Object.fromEntries(rows.map(row => [`${row.source} ${row.external_id}`, row]));
}
