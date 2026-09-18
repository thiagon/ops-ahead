from __future__ import annotations

import logging

from slack_sdk.errors import SlackApiError
from slack_sdk.web.async_client import AsyncWebClient

logger = logging.getLogger(__name__)


class SlackNotifier:
    def __init__(self, token: str, channel_id: str) -> None:
        self._client = AsyncWebClient(token=token)
        self._channel_id = channel_id

    async def send(self, text: str, blocks: list[dict]) -> None:
        try:
            await self._client.chat_postMessage(channel=self._channel_id, text=text, blocks=blocks)
        except SlackApiError:
            logger.exception("Failed to post incident summary to Slack")
            raise
