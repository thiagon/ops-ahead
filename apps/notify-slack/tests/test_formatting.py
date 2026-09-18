from datetime import datetime, timezone
from uuid import uuid4

from formatting import build_summary
from models import IncidentAlertEvent


def _event(**overrides) -> IncidentAlertEvent:
    defaults = dict(
        event_id=uuid4(),
        tenant_id="locaweb",
        source="itsm",
        version="1",
        dictionary_version="1",
        received_at=datetime.now(timezone.utc),
        external_id="INC-123",
        opened_at=datetime.now(timezone.utc),
        severity=1,
        status="open",
        title="Servidor de e-mail fora do ar",
    )
    defaults.update(overrides)
    return IncidentAlertEvent(**defaults)


def test_header_carries_severity_label_and_title():
    event = _event(severity=1, title="Servidor de e-mail fora do ar")
    text, blocks = build_summary(event)

    assert "Crítica" in text
    assert "Servidor de e-mail fora do ar" in text
    assert blocks[0]["type"] == "header"
    assert "🔴" in blocks[0]["text"]["text"]


def test_description_becomes_its_own_section_when_present():
    event = _event(description="Timeout de conexão no MX principal.")
    _, blocks = build_summary(event)

    section_texts = [b["text"]["text"] for b in blocks if b["type"] == "section" and "text" in b]
    assert any("Timeout de conexão" in t for t in section_texts)


def test_no_description_block_when_absent():
    event = _event(description=None)
    _, blocks = build_summary(event)

    section_texts = [b["text"]["text"] for b in blocks if b["type"] == "section" and "text" in b]
    assert section_texts == []


def test_source_url_renders_as_context_link():
    event = _event(source_url="https://itsm.locaweb.com.br/INC-123")
    _, blocks = build_summary(event)

    context_blocks = [b for b in blocks if b["type"] == "context"]
    assert len(context_blocks) == 1
    assert "https://itsm.locaweb.com.br/INC-123" in context_blocks[0]["elements"][0]["text"]
