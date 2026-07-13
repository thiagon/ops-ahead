import great_expectations as gx

from .settings import Settings


def build_context(settings: Settings) -> gx.DataContext:
    conn = (
        f"clickhouse+http://{settings.clickhouse_user}:{settings.clickhouse_password}"
        f"@{settings.clickhouse_host}:{settings.clickhouse_port}"
        f"/{settings.clickhouse_database}"
    )
    context = gx.get_context(mode="ephemeral")
    context.data_sources.add_sql(name="clickhouse", connection_string=conn)
    return context
