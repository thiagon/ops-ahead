-- incidents.received is discontinued (incident-flow_20260819, Phase 2): the
-- single-intake table is superseded by bronze_alert/bronze_monitor, and no
-- consumer reads it any more. Hard cutover, no alias — see plan.md task 2.8.
DROP TABLE IF EXISTS incidents_received;
