import great_expectations as gx
import pytest
import sqlalchemy as sa


@pytest.fixture
def sqlite_engine(tmp_path):
    url = f"sqlite:///{tmp_path / 'snapshot.db'}"
    return sa.create_engine(url), url


@pytest.fixture
def gx_context(sqlite_engine):
    _, url = sqlite_engine
    context = gx.get_context(mode="ephemeral")
    context.data_sources.add_sql(name="clickhouse", connection_string=url)
    return context
