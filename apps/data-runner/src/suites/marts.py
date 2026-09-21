import great_expectations as gx
import great_expectations.expectations as gxe
from great_expectations.core.batch_definition import BatchDefinition
from great_expectations.core.validation_definition import ValidationDefinition
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)


def _table_asset(context: AbstractDataContext, table: str) -> BatchDefinition:
    datasource = context.data_sources.get("clickhouse")
    asset = datasource.add_table_asset(name=table, table_name=table)
    return asset.add_batch_definition_whole_table("full")


def register_incidents_by_ic(context: AbstractDataContext) -> ValidationDefinition:
    batch_def = _table_asset(context, "incidents_by_ic")
    suite = context.suites.add(gx.ExpectationSuite(name="mart_incidents_by_ic"))

    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="tenant_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="entity_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="window_start"))
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="incident_count", min_value=0)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="window_hours", value_set=[1, 6, 24])
    )

    return context.validation_definitions.add(
        gx.ValidationDefinition(name="mart_incidents_by_ic", data=batch_def, suite=suite)
    )


def register_kpi_monthly_state(context: AbstractDataContext) -> ValidationDefinition:
    batch_def = _table_asset(context, "kpi_monthly_state")
    suite = context.suites.add(gx.ExpectationSuite(name="mart_kpi_monthly_state"))

    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="month"))
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="severity", value_set=[1, 2, 3])
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="breach_rate", min_value=0, max_value=1)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="total", min_value=0)
    )

    return context.validation_definitions.add(
        gx.ValidationDefinition(name="mart_kpi_monthly_state", data=batch_def, suite=suite)
    )
