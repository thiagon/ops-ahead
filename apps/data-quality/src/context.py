import great_expectations as gx
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)

from .settings import Settings


def build_context(settings: Settings) -> AbstractDataContext:
    context = gx.get_context(mode="ephemeral")
    context.data_sources.add_sql(name="clickhouse", connection_string=settings.clickhouse_url)
    return context
