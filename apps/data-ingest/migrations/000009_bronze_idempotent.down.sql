RENAME TABLE
    bronze_alert   TO bronze_alert_idempotent,
    bronze_monitor TO bronze_monitor_idempotent,
    bronze_alert_premerge   TO bronze_alert,
    bronze_monitor_premerge TO bronze_monitor;

DROP TABLE IF EXISTS bronze_alert_idempotent;
DROP TABLE IF EXISTS bronze_monitor_idempotent;
