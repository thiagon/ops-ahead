-- Raw ingestion
SELECT count() AS raw_total FROM incidents_raw;
SELECT source, count() AS n FROM incidents_raw GROUP BY source;

-- Mart coverage vs raw
SELECT
    (SELECT count() FROM incidents_raw)           AS raw,
    (SELECT sum(incident_count) FROM incidents_by_ic WHERE window_hours = 24) AS by_ic_24h,
    (SELECT count() FROM first_touch_duration)    AS first_touch,
    (SELECT count() FROM daily_anomaly_features)  AS daily_features,
    (SELECT count() FROM kpi_monthly_state)       AS kpi_monthly;

-- OLA compliance check
SELECT
    severity,
    count()                                                        AS total,
    countIf(entrou_kpi = 1)                                        AS in_kpi,
    countIf(kpi_violado = 1)                                       AS violated,
    round(countIf(kpi_violado = 1) / countIf(entrou_kpi = 1), 3)  AS violation_rate
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
    round(avg(violation_rate), 3) AS avg_violation_rate
FROM daily_anomaly_features;
