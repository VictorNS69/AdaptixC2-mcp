#!/usr/bin/env node

// AdaptixC2 MCP server — read-only recon surface (0.1.0 scaffold).
//
// Every tool is a call against the teamserver's authenticated REST control
// plane (Gin + JWT). No Qt GUI, no WebSocket sync channel, no console typing.
// The read-only tools map 1:1 onto GET endpoints. Command execution and the
// scope-bound execution gate land in the next milestone (README §The
// execution gate).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { AdaptixClient, AdaptixConfig, loadConfig } from "./adaptix.js";

const cfg: AdaptixConfig = loadConfig();

const AGENT_ID = {
  type: "string",
  description: "Agent id from adaptix_agent_list.",
} as const;

const readTools: Tool[] = [
  {
    name: "adaptix_server_status",
    description:
      "Log in to the teamserver and report the pinned version, endpoint and username. Read-only.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "adaptix_agent_list",
    description:
      "List connected agents (beacons): id, name, host, user, OS, listener and state. Read-only.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "adaptix_listener_list",
    description: "List listeners and their state. Read-only.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "adaptix_task_list",
    description:
      "List completed tasks for an agent, including the command output (Text field). Poll this after running a command; output is asynchronous. Read-only.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: AGENT_ID,
        limit: { type: "integer", description: "Maximum number of tasks (default 100)." },
        offset: { type: "integer", description: "Skip the first N tasks (default 0)." },
      },
      required: ["agent_id"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "adaptix_targets_list",
    description: "List the teamserver's tracked targets. Read-only.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "adaptix_creds_list",
    description: "List stored credentials. Read-only.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
];

const server = new Server(
  { name: "adaptixc2-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: readTools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  const str = (key: string, fallback = ""): string => {
    const value = args[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  };
  const num = (key: string, fallback: number): number => {
    const value = args[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
    return fallback;
  };

  try {
    const api = new AdaptixClient(cfg);
    await api.login();

    switch (name) {
      case "adaptix_server_status":
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, endpoint: cfg.endpoint, username: cfg.username, pinned_version: cfg.version },
                null,
                2,
              ),
            },
          ],
        };
      case "adaptix_agent_list":
        return { content: [{ type: "text", text: JSON.stringify(await api.agentList(), null, 2) }] };
      case "adaptix_listener_list":
        return { content: [{ type: "text", text: JSON.stringify(await api.listenerList(), null, 2) }] };
      case "adaptix_task_list": {
        const agentId = str("agent_id");
        if (!agentId) throw new Error("agent_id is required");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await api.taskList(agentId, num("limit", 100), num("offset", 0)), null, 2),
            },
          ],
        };
      }
      case "adaptix_targets_list":
        return { content: [{ type: "text", text: JSON.stringify(await api.targetsList(), null, 2) }] };
      case "adaptix_creds_list":
        return { content: [{ type: "text", text: JSON.stringify(await api.credsList(), null, 2) }] };
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: JSON.stringify({ error: "failed", tool: name, message }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
