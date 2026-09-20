from __future__ import annotations

from model_names import registered_model_name


def test_the_tenant_is_part_of_the_registered_name():
    assert registered_model_name("volume-forecast", "locaweb") == "volume-forecast__locaweb"


def test_two_tenants_never_collide_on_one_name():
    first = registered_model_name("breach-risk", "locaweb")
    second = registered_model_name("breach-risk", "acme")

    assert first != second
