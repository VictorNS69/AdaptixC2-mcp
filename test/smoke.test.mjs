import test from "node:test";
import assert from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "dist", "index.js");

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    child.stdout.on("data", (buf) => this.onData(buf));
    child.stderr.on("data", (c) => (this.stderr += c));
  }

  onData(buf) {
    for (const line of buf.toString().split("\n")) {
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const resolve = this.pending.get(msg.id);
      if (resolve) {
        this.pending.delete(msg.id);
        resolve(msg);
      }
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async init() {
    return this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "smoke", version: "1" },
    });
  }

  async listTools() {
    const listed = await this.request("tools/list");
    return listed.tools.map((t) => t.name).sort();
  }
}

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      ADAPTIX_ENDPOINT: "http://127.0.0.1:4321/endpoint",
      ADAPTIX_PASSWORD: "smoke-test-password",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { child, client: new McpClient(child) };
}

const EXPECTED = [
  "adaptix_agent_command_execute",
  "adaptix_agent_generate",
  "adaptix_agent_list",
  "adaptix_creds_list",
  "adaptix_listener_create",
  "adaptix_listener_edit",
  "adaptix_listener_list",
  "adaptix_listener_pause",
  "adaptix_listener_resume",
  "adaptix_listener_stop",
  "adaptix_server_status",
  "adaptix_targets_list",
  "adaptix_task_list",
];

test("exposes the MCP tools without a teamserver", async () => {
  const { child, client } = startServer();
  try {
    await client.init();
    assert.deepStrictEqual(await client.listTools(), EXPECTED);
  } finally {
    child.kill("SIGKILL");
  }
});

test("a failed tool call returns a JSON error, not a crash", async () => {
  const { child, client } = startServer();
  try {
    await client.init();
    const result = await client.request("tools/call", { name: "adaptix_server_status", arguments: {} });
    assert.strictEqual(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.strictEqual(payload.error, "failed");
    assert.strictEqual(payload.tool, "adaptix_server_status");
    assert.ok(typeof payload.message === "string" && payload.message.length > 0, "message present");
  } finally {
    child.kill("SIGKILL");
  }
});
