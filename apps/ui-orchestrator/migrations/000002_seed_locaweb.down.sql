DELETE FROM config_kpi_target WHERE tenant_id = 'locaweb';
DELETE FROM config_deadline WHERE tenant_id = 'locaweb';
DELETE FROM config_origin WHERE tenant_id = 'locaweb' AND source = 'itsm';
