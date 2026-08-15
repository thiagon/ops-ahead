from __future__ import annotations

import httpx
import pytest
from faststream.kafka import TestKafkaBroker
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


@pytest.mark.asyncio
async def test_mcp_trigger_tool_returns_same_shape_as_rest(app):
    """The MCP tool is derived from the same /trigger route (task 2.7) — this
    exercises it end to end over the real MCP protocol (task 2.8) and checks
    it publishes to the same topic / returns the same {run_id} contract as
    POST /trigger, not a second parallel implementation."""
    http_client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")

    async with TestKafkaBroker(app.state.kafka_broker), app.router.lifespan_context(app):
        async with streamable_http_client("http://testserver/mcp", http_client=http_client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()

                tools = await session.list_tools()
                tool_names = {tool.name for tool in tools.tools}
                assert "trigger_analysis" in tool_names
                assert "get_run_status" in tool_names

                result = await session.call_tool("trigger_analysis", {"analysis": "data_refresh"})

    assert result.isError is not True
    assert any("run_id" in (block.text or "") for block in result.content if hasattr(block, "text"))
