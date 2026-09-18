from __future__ import annotations

from models import IncidentAlertEvent

# domain/ubiquitous-language.md#severity — the only scale the domain knows,
# already translated from whatever the source called it.
SEVERITY_LABELS = {1: "Crítica", 2: "Alta", 3: "Média", 4: "Baixa", 5: "Muito Baixa"}
SEVERITY_EMOJI = {1: "🔴", 2: "🟠", 3: "🟡", 4: "🟢", 5: "⚪"}

STATUS_LABELS = {
    "open": "Aberto",
    "in_progress": "Em andamento",
    "waiting": "Aguardando",
    "resolved": "Resolvido",
    "closed": "Encerrado",
    "canceled": "Cancelado",
    "unknown": "Desconhecido",
}


def build_summary(event: IncidentAlertEvent) -> tuple[str, list[dict]]:
    """Renders one incident-alert event as a Slack message (fallback text + Block Kit).

    One event, one message — no dedup or diffing against a prior state of the
    same incident: every event on events.alert is its own notification, as
    they arrive (domain/ubiquitous-language.md#event).
    """
    emoji = SEVERITY_EMOJI[event.severity]
    severity_label = SEVERITY_LABELS[event.severity]
    status_label = STATUS_LABELS.get(event.status, event.status)

    header = f"{emoji} [{severity_label}] {event.title}"

    fields = [
        f"*Tenant:*\n{event.tenant_id}",
        f"*Origem:*\n{event.source}",
        f"*Status:*\n{status_label}",
        f"*ID externo:*\n{event.external_id}",
        f"*Aberto em:*\n{event.opened_at.isoformat()}",
    ]
    if event.owner:
        fields.append(f"*Dono:*\n{event.owner}")
    if event.entity_id:
        fields.append(f"*Entidade:*\n{event.entity_id}")

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": header, "emoji": True}},
        {"type": "section", "fields": [{"type": "mrkdwn", "text": field} for field in fields]},
    ]

    if event.description:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": event.description}})

    if event.source_url:
        blocks.append(
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": f"<{event.source_url}|Abrir na origem>"}],
            }
        )

    text = f"{header} — {event.tenant_id}/{event.source} ({status_label})"
    return text, blocks
