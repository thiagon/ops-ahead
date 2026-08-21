-- Ingestion (incidents.received retired by incident-flow_20260819 — bronze is
-- split by intake now)
SELECT count() AS alert_total FROM bronze_alert;
SELECT count() AS monitor_total FROM bronze_monitor;
SELECT source, count() AS n FROM bronze_alert GROUP BY source;
SELECT source, count() AS n FROM bronze_monitor GROUP BY source;

-- Mart coverage vs ingestion — the marts below are pending the per-chain
-- rebuild in incident-flow_20260819's later phases; this section is stale
-- until then.
SELECT
    (SELECT count() FROM bronze_alert)            AS received,
    (SELECT sum(incident_count) FROM incidents_by_ic WHERE window_hours = 24) AS by_ic_24h,
    (SELECT count() FROM first_touch_duration)    AS first_touch,
    (SELECT count() FROM daily_anomaly_features)  AS daily_features,
    (SELECT count() FROM kpi_monthly_state)       AS kpi_monthly;

-- OLA compliance check
SELECT
    severity,
    count()                                                            AS total,
    countIf(counted_in_kpi = 1)                                        AS in_kpi,
    countIf(kpi_breached = 1)                                          AS breached,
    round(countIf(kpi_breached = 1) / countIf(counted_in_kpi = 1), 3)  AS breach_rate
FROM first_touch_duration
GROUP BY severity
ORDER BY severity;

-- P4 sequences summary
SELECT
    entity_id,
    count()          AS total_sequences,
    max(sequence_length) AS longest_sequence
FROM p4_sequences_by_ci
GROUP BY entity_id
ORDER BY longest_sequence DESC
LIMIT 10;

-- Daily anomaly features sanity
SELECT
    min(date)  AS from_date,
    max(date)  AS to_date,
    count()    AS days,
    sum(total_incidents) AS total_events,
    round(avg(breach_rate), 3) AS avg_breach_rate
FROM daily_anomaly_features;
