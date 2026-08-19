from prometheus_client import Counter, Gauge, start_http_server

messages_consumed = Counter(
    "ml_trainer_messages_consumed_total",
    "Total trigger.ml messages consumed",
    ["analysis"],
)

# Set after each drift_monitoring run and held until the next one — Gauges
# report whatever was last .set(), so this stays scrapeable between runs
# instead of only existing for the instant the analysis executes.
feature_drift_psi = Gauge(
    "ml_trainer_feature_drift_psi",
    "PSI between the Production model's training window and the current mart window, per feature",
    ["domain", "feature"],
)
feature_drift_ks_pvalue = Gauge(
    "ml_trainer_feature_drift_ks_pvalue",
    "KS test p-value between the Production model's training window and the current mart window "
    "(numeric features only) — low means drift",
    ["domain", "feature"],
)


def start(port: int) -> None:
    start_http_server(port)
