import great_expectations as gx
import great_expectations.expectations as gxe
from great_expectations.core.validation_definition import ValidationDefinition
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)

from .marts import _table_asset


def register_gold_monitor_signal_counts(context: AbstractDataContext) -> ValidationDefinition:
    batch_def = _table_asset(context, "gold_monitor_signal_counts")
    suite = context.suites.add(gx.ExpectationSuite(name="gold_monitor_signal_counts"))

    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="tenant_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="entity_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="window_start"))
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeInSet(column="window_minutes", value_set=[15, 60, 360])
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="signal_count", min_value=0)
    )

    return context.validation_definitions.add(
        gx.ValidationDefinition(name="gold_monitor_signal_counts", data=batch_def, suite=suite)
    )
