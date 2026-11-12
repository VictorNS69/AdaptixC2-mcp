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
import { artifactPath } from "./artifacts.js";
import { normalizeCommandArgs } from "./commands.js";

const cfg: AdaptixConfig = loadConfig();

const AGENT_ID = {
  type: "string",
  description: "Agent id from adaptix_agent_list.",
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The agent records in a /agent/list payload, whatever shape it arrives in. */
function agentArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    for (const key of ["agents", "Agents", "list", "data"]) {
      const value = obj[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        const values = Object.values(value as Record<string, unknown>);
        if (values.length > 0 && values.every((v) => v && typeof v === "object")) return values;
      }
    }
  }
  return [];
}

/** Agents present, optionally only those whose record mentions `match` (IP, hostname, listener). */
function countAgents(payload: unknown, match: string): number {
  const wanted = match.trim().toLowerCase();
  return agentArray(payload).filter(
    (a) => wanted === "" || JSON.stringify(a).toLowerCase().includes(wanted),
  ).length;
}

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
    name: "adaptix_agent_wait",
    description:
      "Wait for beacons to check in, then return them. Polls GET /agent/list until at least `expected` agents are present — optionally only those whose record contains `match` (an IP, hostname or listener name) — and reports the count it reached. Meant for the multi-host case: generate and deliver an artifact per host, then one call here per host (expected 1, match <host>) or one call with expected N after a batch. A timeout returns ok:false with the count and the agents it did see, never a silent success.",
    inputSchema: {
      type: "object" as const,
      properties: {
        expected: { type: "number", description: "How many agents to wait for (default 1)." },
        match: {
          type: "string",
          description:
            "Only count agents whose JSON record contains this substring — the target IP or hostname you delivered to.",
        },
        timeout_s: { type: "number", description: "Give up after this many seconds (default 60)." },
        interval_s: { type: "number", description: "Poll interval in seconds (default 3)." },
      },
      required: [],
    },
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
      "Start a listener. name is the operator-facing listener name; type is the listener kind (e.g. BeaconHTTP, GopherTCP); config is a JSON string of THAT TYPE's own options — the schema is the extender's, and the types differ: BeaconHTTP takes callback_addresses as an array of \"host:port\", GopherTCP takes it as a single string; encrypt_key must be exactly 32 hex characters and BeaconHTTP's page-payload must contain <<<PAYLOAD_DATA>>>. A rejected config is named one field at a time. Returns verified: true only when the listener is in /listener/list.",
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
      "Build an agent artifact. agent is the agent kind (beacon, kharon, gopher); listener_name is the listener it calls back to; config is a JSON string of THAT agent's build options — beacon is Windows-only (arch x64|x86, format Exe|Service Exe|DLL|Shellcode, sleep a STRING, jitter an INT); gopher covers linux|windows|macos (arch amd64|arm64, format Binary EXE, reconn_timeout a STRING, reconn_count an INT); label names the host it is for and is folded into the filename. gopher/kharon compile from source inside the install tree, so a root-owned install fails with permission denied — stage the extender beside the teamserver config instead. Writes the binary to output_dir and returns its path. Never overwrites an earlier build.",
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
        label: {
          type: "string",
          description:
            "Tag folded into the filename so builds for several hosts never collide or overwrite: pass the target IP or hostname (agent-10.10.10.5.exe). Omitted = the teamserver's own name, with -2/-3 appended rather than overwriting.",
        },
      },
      required: ["agent", "listener_name", "config"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_agent_command_execute",
    description:
      "Run a command on an agent. cmdline is the agent command name (e.g. shell, powershell, cat, ls, cd, download, socks, exit); data is a JSON string of that command's arguments. Argument names are per-command and this server normalizes the obvious ones: shell/powershell take {\"cmd_params\":\"whoami\"}, cat/ls/cd/mkdir take {\"path\":\"C:\\\\Users\"}, download takes {\"file\":\"<remote path>\"}, cp/mv take {\"src\":…,\"dst\":…}. {\"command\":…}, {\"cmd\":…}, {\"cmdline\":…} and a bare string are translated to the right key for the commands in that table; anything else is passed through verbatim with a warning. Set wait_answer true to wait inline; otherwise poll adaptix_task_list — a task that reports 'undefined' means the key was wrong.",
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
  {
    name: "adaptix_agent_remove",
    description:
      "Remove agents from the teamserver (e.g. dead beacons). agent_ids is the list of agent ids from adaptix_agent_list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_ids: {
          type: "array",
          items: { type: "string" },
          description: "Agent ids from adaptix_agent_list.",
        },
      },
      required: ["agent_ids"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_task_cancel",
    description:
      "Cancel queued tasks for an agent. task_ids is the list of task ids from adaptix_task_list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: AGENT_ID,
        task_ids: { type: "array", items: { type: "string" }, description: "Task ids from adaptix_task_list." },
      },
      required: ["agent_id", "task_ids"],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: "adaptix_task_delete",
    description:
      "Delete completed tasks for an agent. task_ids is the list of task ids from adaptix_task_list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        agent_id: AGENT_ID,
        task_ids: { type: "array", items: { type: "string" }, description: "Task ids from adaptix_task_list." },
      },
      required: ["agent_id", "task_ids"],
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
  const arr = (key: string): string[] => {
    const value = args[key];
    if (Array.isArray(value)) return value.map((v) => String(v)).filter((v) => v !== "");
    if (typeof value === "string" && value.trim() !== "") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter((v) => v !== "");
      } catch {
        /* not JSON */
      }
      return value.split(",").map((v) => v.trim()).filter((v) => v !== "");
    }
    return [];
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
      case "adaptix_agent_wait": {
        const expected = Math.max(1, num("expected", 1));
        const match = str("match");
        const timeoutS = Math.max(1, num("timeout_s", 60));
        const intervalS = Math.max(1, num("interval_s", 3));
        const deadline = Date.now() + timeoutS * 1000;
        let agents: unknown = null;
        let count = 0;
        for (;;) {
          agents = await api.agentList();
          count = countAgents(agents, match);
          if (count >= expected) break;
          const left = deadline - Date.now();
          if (left <= 0) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: false,
                      expected,
                      count,
                      match: match || null,
                      waited_s: Math.round((timeoutS * 1000 - left) / 1000),
                      detail:
                        `only ${count} of ${expected} agent(s) checked in within ${timeoutS}s` +
                        (match ? ` matching '${match}'` : "") +
                        ". The agent binary did not run, could not reach the listener (egress, wrong" +
                        " callback host/port, TLS on a plain listener), or the listener is not the one the" +
                        " build calls back to — adaptix_listener_list shows listener state.",
                      agents,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
          await sleep(Math.min(intervalS * 1000, left));
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ok: true, expected, count, match: match || null, agents },
                null,
                2,
              ),
            },
          ],
        };
      }
      case "adaptix_listener_list":
        return { content: [{ type: "text", text: JSON.stringify(await api.listenerList(), null, 2) }] };
      case "adaptix_listener_create": {
        const listenerName = str("name");
        const type = str("type");
        const config = str("config");
        if (!listenerName || !type || !config) throw new Error("name, type and config are required");
        const created = await api.listenerCreate(listenerName, type, config);
        // The teamserver answers these with HTTP 200 and an {ok, message} body,
        // so a rejected config (bad port, unknown handler, listener already
        // running) reads as success. Confirm on the teamserver's own state
        // before reporting one: a listener nobody can call back to is the one
        // failure that shows up 20 minutes later as "beacons never arrive".
        const listed = JSON.stringify(await api.listenerList());
        if (!listed.includes(listenerName)) {
          throw new Error(
            `listener '${listenerName}' is not in /listener/list after create — it did not start. ` +
              `teamserver said: ${JSON.stringify(created).slice(0, 300)}. ` +
              "Check the listener type (e.g. GopherTCP, BeaconHTTP) and the config fields it takes; " +
              "adaptix_listener_list shows what is actually running.",
          );
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ verified: true, listener: listenerName, type, created }, null, 2),
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
        const label = str("label");
        if (!agent || !listener || !config) throw new Error("agent, listener_name and config are required");
        const { fileName, content } = await api.agentGenerate(agent, [listener], config);
        const outputDir = str("output_dir", cfg.outputDir);
        fs.mkdirSync(outputDir, { recursive: true });
        const outPath = artifactPath(outputDir, fileName, label);
        fs.writeFileSync(outPath, content);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  agent,
                  listener,
                  label: label || null,
                  fileName: path.basename(outPath),
                  serverFileName: fileName,
                  path: outPath,
                  bytes: content.length,
                },
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
        const normalized = normalizeCommandArgs(cmdline, str("data", "{}"));
        const waitAnswer = args["wait_answer"] === true;
        const result = await api.agentCommandExecute(agentId, cmdline, normalized.data, waitAnswer);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  result,
                  data_sent: normalized.data,
                  ...(normalized.translatedFrom ? { translated_from: normalized.translatedFrom } : {}),
                  ...(normalized.warning ? { warning: normalized.warning } : {}),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      case "adaptix_agent_remove": {
        const agentIds = arr("agent_ids");
        if (agentIds.length === 0) throw new Error("agent_ids must be a non-empty array");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.agentRemove(agentIds), null, 2) },
          ],
        };
      }
      case "adaptix_task_cancel": {
        const agentId = str("agent_id");
        const taskIds = arr("task_ids");
        if (!agentId || taskIds.length === 0) throw new Error("agent_id and non-empty task_ids are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.taskCancel(agentId, taskIds), null, 2) },
          ],
        };
      }
      case "adaptix_task_delete": {
        const agentId = str("agent_id");
        const taskIds = arr("task_ids");
        if (!agentId || taskIds.length === 0) throw new Error("agent_id and non-empty task_ids are required");
        return {
          content: [
            { type: "text", text: JSON.stringify(await api.taskDelete(agentId, taskIds), null, 2) },
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
