import great_expectations as gx
import great_expectations.expectations as gxe
from great_expectations.core.validation_definition import ValidationDefinition
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)

from great_expectations.expectations.core.unexpected_rows_expectation import (
    UnexpectedRowsExpectation,
)


def register(context: AbstractDataContext) -> ValidationDefinition:
    datasource = context.data_sources.get("clickhouse")
    asset = datasource.add_table_asset(
        name="incidents_received", table_name="incidents_received"
    )
    batch_def = asset.add_batch_definition_whole_table("full")

    suite = context.suites.add(gx.ExpectationSuite(name="critical"))

    # ExpectColumnValuesToBeUnique casts through Decimal(None, None) in its
    # generic SQL path, which ClickHouse rejects.
    suite.add_expectation(
        UnexpectedRowsExpectation(
            unexpected_rows_query=(
                "SELECT event_id FROM {batch} GROUP BY event_id HAVING count(*) > 1"
            )
        )
    )
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="event_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="opened_at"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="received_at"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="entity_id"))
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="severity", min_value=1, max_value=5)
    )
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="severity"))
    # opened_at must not be in the future relative to received_at. Same
    # Decimal cast issue as above.
    suite.add_expectation(
        UnexpectedRowsExpectation(
            unexpected_rows_query="SELECT * FROM {batch} WHERE received_at < opened_at"
        )
    )

    return context.validation_definitions.add(
        gx.ValidationDefinition(
            name="critical",
            data=batch_def,
            suite=suite,
        )
    )
