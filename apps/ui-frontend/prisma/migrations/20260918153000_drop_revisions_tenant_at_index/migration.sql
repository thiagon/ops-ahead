-- listRevisions is a small take-50 per tenant; the PK is enough.
DROP INDEX IF EXISTS "config_revisions_tenant_id_at_idx";
