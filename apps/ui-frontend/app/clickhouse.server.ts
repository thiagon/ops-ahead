import { type ClickHouseClient, createClient } from '@clickhouse/client';
import { getConfig } from './config.server.ts';
import { currentTenant } from './features/config/repo.server.ts';
import type {
  MilestoneRow,
  SeverityChangeRow,
  SimilarIncidentRow,
  VolumeForecastRow,
} from './types.ts';

export type {
  MilestoneRow,
  SeverityChangeRow,
  SimilarIncidentRow,
  VolumeForecastRow,
} from './types.ts';

/**
 * One row per tenant_id × as_of_date × severities, written by ml-trainer's
 * kpi_projection analysis. `severities` is the band itself — the text on the
 * axis is formatted here, never stored.
 */
export interface KpiProjectionRow {
  tenant_id: string;
  as_of_date: string;
  severities: number[];
  median_breaches_ytd: number;
  ci80_lower: number;
  ci80_upper: number;
  p_within_target: number | null;
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

/** One row per year × month × severities, cumulative against the annual band. */
export interface KpiAchievementRow {
  year: number;
  month: string;
  severities: number[];
  breached_ytd: number;
  achievement_pct: number;
}

/**
 * One row per target_date × category × product × horizon, from
 * gold_entity_forecast — the forecast that names which products to look at,
 * as opposed to the aggregate volume one.
 */
export interface EntityForecastRow {
  target_date: string;
  category: string;
  product: string;
  horizon: number;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

/**
 * One behaviour group, from gold_recurring_cause_groups. `silhouette` is how
 * separable the grouping was — a low score means no structure was found, and
 * the screen says so rather than drawing groups.
 */
export interface RecurringCauseGroupRow {
  group_id: number;
  entity_count: number;
  silhouette: number;
  distinguishing_features: string;
  top_products: string;
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

/** One row per date × source, the alert chain's daily composition — gold_alert_daily_features. */
export interface AlertDailyFeatureRow {
  date: string;
  source: string;
  total_incidents: number;
  p1_share: number;
  critical_share: number;
  no_intervention_share: number;
  incidents_per_entity: number;
  /** null on days where nothing closed — there is no duration to take a median of. */
  median_duration_seconds: number | null;
}

/** Recurring entity × category × severity pattern, from gold_alert_category_entity_breakdown. */
export interface RecurringPatternRow {
  category: string;
  product: string;
  entity_id: string;
  severity: number;
  incident_count: number;
  breached: number;
  avg_duration_seconds: number;
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
    `select tenant_id, toString(as_of_date) as as_of_date, severities,
            median_breaches_ytd, ci80_lower, ci80_upper, p_within_target
     from gold_kpi_projection
     where tenant_id = {tenant_id:String}
     order by as_of_date desc, severities
     limit {limit:UInt32} by severities`,
    { tenant_id: (await currentTenant()).slug, limit: asOfLimit },
  );
}

export async function fetchVolumeForecast(): Promise<VolumeForecastRow[]> {
  return await query<VolumeForecastRow>(
    `select toString(target_date) as target_date, priority_group, horizon,
            yhat, yhat_lower, yhat_upper
     from gold_volume_forecast
     where tenant_id = {tenant_id:String}
     order by target_date desc, priority_group, horizon
     limit 1 by priority_group, horizon`,
    { tenant_id: (await currentTenant()).slug },
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
    `select year, toString(month) as month, severities, breached_ytd, achievement_pct
     from (
       select year, month, severities, breached_ytd, achievement_pct
       from gold_alert_kpi_achievement
       where tenant_id = {tenant_id:String}
         and month >= toStartOfMonth(now()) - toIntervalMonth({months_back:UInt32})
       order by month asc, severities
     )`,
    { tenant_id: (await currentTenant()).slug, months_back: monthsBack },
  );
}

export async function fetchEntityForecast(): Promise<EntityForecastRow[]> {
  return await query<EntityForecastRow>(
    // The latest run's forecast per series, not a history: `limit 1 by`
    // keeps the most recent target_date for each product × horizon.
    `select toString(target_date) as target_date, category, product, horizon,
            yhat, yhat_lower, yhat_upper
     from gold_entity_forecast
     where tenant_id = {tenant_id:String}
     order by target_date desc, yhat desc
     limit 1 by category, product, horizon`,
    { tenant_id: (await currentTenant()).slug },
  );
}

export async function fetchRecurringCauseGroups(): Promise<RecurringCauseGroupRow[]> {
  return await query<RecurringCauseGroupRow>(
    // The latest run only: groups from two different runs are not comparable
    // side by side, since the group ids are per run.
    `select group_id, entity_count, silhouette, distinguishing_features, top_products
     from gold_recurring_cause_groups
     where tenant_id = {tenant_id:String}
       and as_of_date = (
         select max(as_of_date) from gold_recurring_cause_groups
         where tenant_id = {tenant_id:String}
       )
     order by entity_count desc`,
    { tenant_id: (await currentTenant()).slug },
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
       where tenant_id = {tenant_id:String}
         and date >= today() - {days_back:UInt32}
       order by date desc, total_incidents desc
     )`,
    { tenant_id: (await currentTenant()).slug, days_back: daysBack },
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

/** How many occurrences are open right now — the sidebar's queue badge. */
export async function fetchOpenAlertCount(): Promise<number> {
  const rows = await query<{ open_count: string }>(
    `select toString(count()) as open_count
     from silver_alert_open
     where tenant_id = {tenant_id:String}`,
    { tenant_id: (await currentTenant()).slug },
  );
  return Number(rows[0]?.open_count ?? 0);
}

export async function fetchOpenAlerts(limit = 200): Promise<OpenAlertRow[]> {
  return await query<OpenAlertRow>(OPEN_ALERTS_SQL, {
    tenant_id: (await currentTenant()).slug,
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
    { tenant_id: (await currentTenant()).slug, source, external_id: externalId },
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
    { tenant_id: (await currentTenant()).slug, source, external_id: externalId },
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
    { tenant_id: (await currentTenant()).slug, source, external_id: externalId },
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
    { tenant_id: (await currentTenant()).slug },
  );

  return Object.fromEntries(rows.map(row => [`${row.source} ${row.external_id}`, row]));
}

/**
 * Closed occurrences with the same owner + severity — the closest real
 * substitute for "similar incidents already resolved": no clustering model
 * exists yet, but the breach consolidation gold already carries the grain
 * this comparison needs. The title and entity live in `silver_alert`; the mart
 * keeps only the breach measurements.
 */
export async function fetchSimilarIncidents(
  owner: string,
  severity: number,
  excludeExternalId: string,
  limit = 5,
): Promise<SimilarIncidentRow[]> {
  return await query<SimilarIncidentRow>(
    `select c.source                        as source,
            c.external_id                   as external_id,
            c.owner                         as owner,
            c.severity                      as severity,
            a.title                         as title,
            a.entity_id                     as entity_id,
            c.duration_seconds              as duration_seconds,
            c.deadline_seconds              as deadline_seconds,
            toUInt8(c.has_breached)         as has_breached,
            toString(c.closed_at)           as closed_at
     from gold_alert_breach_consolidation c
     left join silver_alert a
       on a.tenant_id = c.tenant_id and a.source = c.source and a.external_id = c.external_id
     where c.tenant_id = {tenant_id:String}
       and c.owner = {owner:String}
       and c.severity = {severity:UInt8}
       and c.external_id != {exclude_external_id:String}
     order by c.closed_at desc
     limit {limit:UInt32}`,
    {
      tenant_id: (await currentTenant()).slug,
      owner,
      severity,
      exclude_external_id: excludeExternalId,
      limit,
    },
  );
}

/**
 * The N most recent days that actually carry data, not a window relative to
 * `today()`: the ITSM base being replayed ends well before the wall clock, so
 * a calendar window renders the series empty or two points long.
 */
export async function fetchAlertDailyFeatures(daysBack = 14): Promise<AlertDailyFeatureRow[]> {
  return await query<AlertDailyFeatureRow>(
    `select toString(date) as date, source, total_incidents, p1_share, critical_share,
            no_intervention_share, incidents_per_entity, median_duration_seconds
     from (
       select date, source, total_incidents, p1_share, critical_share,
              no_intervention_share, incidents_per_entity, median_duration_seconds
       from gold_alert_daily_features
       where tenant_id = {tenant_id:String}
         and date in (
           select date from gold_alert_daily_features
           where tenant_id = {tenant_id:String}
           group by date order by date desc limit {days_back:UInt32}
         )
       order by date desc
     )`,
    { tenant_id: (await currentTenant()).slug, days_back: daysBack },
  );
}

/**
 * Recurring entity × category × severity patterns — the clustering/recurring
 * cause input the challenge asks for (docs/context/challenges.md, "Agrupar
 * causas recorrentes"). Aggregated over the window, ranked by volume.
 */
export async function fetchRecurringPatterns(
  daysBack = 30,
  limit = 10,
): Promise<RecurringPatternRow[]> {
  return await query<RecurringPatternRow>(
    // Same anchoring as fetchAlertDailyFeatures — the N most recent days that
    // carry data, not a calendar window.
    `select category, product, entity_id, severity,
            sum(incident_count) as incident_count,
            sum(breached) as breached,
            avg(avg_duration_seconds) as avg_duration_seconds
     from gold_alert_category_entity_breakdown
     where tenant_id = {tenant_id:String}
       and date in (
         select date from gold_alert_category_entity_breakdown
         where tenant_id = {tenant_id:String}
         group by date order by date desc limit {days_back:UInt32}
       )
     group by category, product, entity_id, severity
     having incident_count > 1
     order by incident_count desc
     limit {limit:UInt32}`,
    { tenant_id: (await currentTenant()).slug, days_back: daysBack, limit },
  );
}
