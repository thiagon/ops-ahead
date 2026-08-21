import great_expectations as gx
from great_expectations.core.validation_definition import ValidationDefinition
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)
from great_expectations.expectations.core.unexpected_rows_expectation import (
    UnexpectedRowsExpectation,
)

from .marts import _table_asset

# Deduplication is what turns bronze (one row per event) into silver (one row
# per occurrence) — a key that still repeats here means the dedup did not
# collapse it, and counts downstream would multiply events instead of
# occurrences (domain spec: Silver — a ocorrência e a condição).
_DEDUP_QUERY = (
    "SELECT tenant_id, source, external_id FROM {batch} "
    "GROUP BY tenant_id, source, external_id HAVING count(*) > 1"
)


def register_silver_alert(context: AbstractDataContext) -> ValidationDefinition:
    batch_def = _table_asset(context, "silver_alert")
    suite = context.suites.add(gx.ExpectationSuite(name="silver_alert"))

    suite.add_expectation(UnexpectedRowsExpectation(unexpected_rows_query=_DEDUP_QUERY))

    return context.validation_definitions.add(
        gx.ValidationDefinition(name="silver_alert", data=batch_def, suite=suite)
    )


def register_silver_monitor(context: AbstractDataContext) -> ValidationDefinition:
    batch_def = _table_asset(context, "silver_monitor")
    suite = context.suites.add(gx.ExpectationSuite(name="silver_monitor"))

    suite.add_expectation(UnexpectedRowsExpectation(unexpected_rows_query=_DEDUP_QUERY))

    return context.validation_definitions.add(
        gx.ValidationDefinition(name="silver_monitor", data=batch_def, suite=suite)
    )
