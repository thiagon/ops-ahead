from bindings import BindingRegistry, parse_bindings

RECORD = {
    "tenant_id": "locaweb",
    "source": "service_now",
    "intake": "alert",
    "bindings": {
        "external_id": "fields.number",
        "status": "fields.state.name",
        "acknowledged_at": None,
    },
}


def test_drops_a_field_the_origin_does_not_send():
    bindings = parse_bindings(RECORD)

    assert "acknowledged_at" not in bindings.paths
    assert bindings.value({"fields": {}}, "acknowledged_at") is None


def test_reads_a_dotted_path_segment_by_segment():
    bindings = parse_bindings(RECORD)

    body = {"fields": {"number": "INC1", "state": {"name": "Encerrado"}}}

    assert bindings.value(body, "external_id") == "INC1"
    assert bindings.value(body, "status") == "Encerrado"


def test_a_path_that_does_not_resolve_reads_as_none():
    bindings = parse_bindings(RECORD)

    # The origin stopped sending the nested object; the field reads as absent
    # rather than raising mid-batch.
    assert bindings.value({"fields": {"number": "INC1"}}, "status") is None
    assert bindings.value({"fields": "not an object"}, "status") is None


def test_never_binds_a_field_the_pipeline_stamps_itself():
    bindings = parse_bindings({**RECORD, "bindings": {"tenant_id": "customer"}})

    assert bindings.paths == {}


def test_keys_an_origin_by_tenant_and_source():
    registry = BindingRegistry()
    registry.record(parse_bindings(RECORD))

    assert registry.get("locaweb", "service_now") is not None
    assert registry.get("outro", "service_now") is None


def test_joins_label_entries_into_key_paths():
    bindings = parse_bindings(
        {
            **RECORD,
            "bindings": {
                **RECORD["bindings"],
                "labels": [
                    {"key": "product", "path": "payload.product"},
                    {"key": "category", "path": "payload.category"},
                ],
            },
        }
    )

    assert "labels" not in bindings.paths
    assert bindings.label_paths == {
        "product": "payload.product",
        "category": "payload.category",
    }
