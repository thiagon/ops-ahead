from collections.abc import Callable

from great_expectations.core.validation_definition import ValidationDefinition
from great_expectations.data_context.data_context.abstract_data_context import (
    AbstractDataContext,
)

from .critical import register as register_critical
from .marts import (
    register_daily_anomaly_features,
    register_incidents_by_ic,
    register_kpi_monthly_state,
)
from .gold_monitor import register_gold_monitor_signal_counts
from .silver import register_silver_alert, register_silver_monitor

REGISTRY: dict[str, Callable[[AbstractDataContext], ValidationDefinition]] = {
    "critical": register_critical,
    "mart_incidents_by_ic": register_incidents_by_ic,
    "mart_daily_anomaly_features": register_daily_anomaly_features,
    "mart_kpi_monthly_state": register_kpi_monthly_state,
    "silver_alert": register_silver_alert,
    "silver_monitor": register_silver_monitor,
    "gold_monitor_signal_counts": register_gold_monitor_signal_counts,
}
