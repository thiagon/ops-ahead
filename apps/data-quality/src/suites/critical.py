import great_expectations as gx
import great_expectations.expectations as gxe


def register(context: gx.DataContext) -> gx.ValidationDefinition:
    datasource = context.data_sources.get("clickhouse")
    asset = datasource.add_table_asset(name="incidents_received", table_name="incidents_received")
    batch_def = asset.add_batch_definition_whole_table("full")

    suite = context.suites.add(gx.ExpectationSuite(name="critical"))

    suite.add_expectation(gxe.ExpectColumnValuesToBeUnique(column="event_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="event_id"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="opened_at"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="received_at"))
    suite.add_expectation(gxe.ExpectColumnValuesToNotBeNull(column="entity_id"))
    suite.add_expectation(
        gxe.ExpectColumnValuesToBeBetween(column="severity", min_value=1, max_value=5)
    )
    suite.add_expectation(
        gxe.ExpectColumnValuesToNotBeNull(column="severity")
    )
    # opened_at must not be in the future relative to received_at
    suite.add_expectation(
        gxe.ExpectColumnPairValuesAToBeGreaterThanB(
            column_A="received_at",
            column_B="opened_at",
            or_equal=True,
        )
    )

    return context.validation_definitions.add(
        gx.ValidationDefinition(
            name="critical",
            data=batch_def,
            suite=suite,
        )
    )
