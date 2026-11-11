#!/usr/bin/env node

// AdaptixC2 MCP server — recon + artifact surface.
//
// Every tool is a call against the teamserver's authenticated REST control
// plane (Gin + JWT). No Qt GUI, no WebSocket sync channel, no console typing.
// Read-only tools map onto GET endpoints; listener_create and agent_generate
// map onto POST /listener/create and POST /agent/generate. Command execution
// and the scope-bound execution gate land in the next milestone (README §The
// execution gate).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";

import { AdaptixClient, AdaptixConfig, loadConfig } from "./adaptix.js";

const cfg: AdaptixConfig = loadConfig();

const AGENT_ID = {
  type: "string",
  description: "Agent id from adaptix_agent_list.",
} as const;

const tools: Tool[] = [
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
    name: "adaptix_listener_create",
    description:
      "Start a listener. name is the operator-facing listener name; type is the listener kind (e.g. BeaconHTTP, GopherTCP); config is a JSON string of that listener's options. Returns the teamserver's {ok, message}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Operator-facing listener name (unique)." },
        type: { type: "string", description: "Listener kind, e.g. GopherTCP or BeaconHTTP." },
        config: { type: "string", description: "JSON string of the listener's options." },
      },
      required: ["name", "type", "config"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_listener_stop",
    description:
      "Stop a running listener. name is the operator-facing listener name; type is the listener kind. Returns the teamserver's {ok, message}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Listener name (from adaptix_listener_list)." },
        type: { type: "string", description: "Listener kind, e.g. GopherTCP or BeaconHTTP." },
      },
      required: ["name", "type"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_listener_pause",
    description:
      "Pause a running listener without stopping it. name and type identify the listener. Returns {ok, message}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Listener name (from adaptix_listener_list)." },
        type: { type: "string", description: "Listener kind, e.g. GopherTCP or BeaconHTTP." },
      },
      required: ["name", "type"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_listener_resume",
    description:
      "Resume a paused listener. name and type identify the listener. Returns {ok, message}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Listener name (from adaptix_listener_list)." },
        type: { type: "string", description: "Listener kind, e.g. GopherTCP or BeaconHTTP." },
      },
      required: ["name", "type"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_listener_edit",
    description:
      "Edit a running listener's configuration. name and type identify the listener; config is the new JSON string of its options.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Listener name (from adaptix_listener_list)." },
        type: { type: "string", description: "Listener kind, e.g. GopherTCP or BeaconHTTP." },
        config: { type: "string", description: "JSON string of the new listener options." },
      },
      required: ["name", "type", "config"],
    },
    annotations: { destructiveHint: true },
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
  {
    name: "adaptix_agent_generate",
    description:
      "Build an agent artifact. agent is the agent kind (beacon, kharon, gopher); listener_name is the listener it calls back to; config is a JSON string of build options (os, arch, format, sleep, ...). Writes the binary to output_dir and returns its path.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent: { type: "string", description: "Agent kind: beacon, kharon or gopher." },
        listener_name: { type: "string", description: "Listener name the agent calls back to." },
        config: { type: "string", description: "JSON string of the agent's build options." },
        output_dir: {
          type: "string",
          description: "Directory to write the artifact (default ADAPTIX_OUTPUT_DIR or ./adaptix-artifacts).",
        },
      },
      required: ["agent", "listener_name", "config"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_agent_command_execute",
    description:
      "Run a command on an agent. cmdline is the agent command name (e.g. shell, sleep, cat, socks, exit); data is a JSON string of that command's arguments (e.g. {\"command\":\"id\"}). Set wait_answer true to get the result inline; otherwise poll adaptix_task_list for the output.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: AGENT_ID,
        cmdline: { type: "string", description: "Agent command name, e.g. shell, sleep, cat, socks, exit." },
        data: { type: "string", description: "JSON string of the command's arguments (default \"{}\")." },
        wait_answer: { type: "boolean", description: "Wait for the command result inline (default false)." },
      },
      required: ["agent_id", "cmdline"],
    },
    annotations: { destructiveHint: true },
  },
];

const server = new Server(
  { name: "adaptixc2-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

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
      case "adaptix_listener_create": {
        const listenerName = str("name");
        const type = str("type");
        const config = str("config");
        if (!listenerName || !type || !config) throw new Error("name, type and config are required");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await api.listenerCreate(listenerName, type, config), null, 2),
            },
          ],
        };
      }
      case "adaptix_listener_stop": {
        const listenerName = str("name");
        const type = str("type");
        if (!listenerName || !type) throw new Error("name and type are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.listenerStop(listenerName, type), null, 2) },
          ],
        };
      }
      case "adaptix_listener_pause": {
        const listenerName = str("name");
        const type = str("type");
        if (!listenerName || !type) throw new Error("name and type are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.listenerPause(listenerName, type), null, 2) },
          ],
        };
      }
      case "adaptix_listener_resume": {
        const listenerName = str("name");
        const type = str("type");
        if (!listenerName || !type) throw new Error("name and type are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.listenerResume(listenerName, type), null, 2) },
          ],
        };
      }
      case "adaptix_listener_edit": {
        const listenerName = str("name");
        const type = str("type");
        const config = str("config");
        if (!listenerName || !type || !config) throw new Error("name, type and config are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.listenerEdit(listenerName, type, config), null, 2) },
          ],
        };
      }
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
      case "adaptix_agent_generate": {
        const agent = str("agent");
        const listener = str("listener_name");
        const config = str("config");
        if (!agent || !listener || !config) throw new Error("agent, listener_name and config are required");
        const { fileName, content } = await api.agentGenerate(agent, [listener], config);
        const outputDir = str("output_dir", cfg.outputDir);
        fs.mkdirSync(outputDir, { recursive: true });
        const outPath = path.join(outputDir, fileName);
        fs.writeFileSync(outPath, content);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, agent, listener, fileName, path: outPath, bytes: content.length },
                null,
                2,
              ),
            },
          ],
        };
      }
      case "adaptix_agent_command_execute": {
        const agentId = str("agent_id");
        const cmdline = str("cmdline");
        if (!agentId || !cmdline) throw new Error("agent_id and cmdline are required");
        const data = str("data", "{}");
        const waitAnswer = args["wait_answer"] === true;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(await api.agentCommandExecute(agentId, cmdline, data, waitAnswer), null, 2),
            },
          ],
        };
      }
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
