// The Data field that actually reaches /agent/command/execute.
//
// The unit test pins the normalizer; this one proves the tool sends the
// normalized payload over the wire — the difference between "our helper is
// right" and "the agent receives the right key".

import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

function stubTeamserver() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = (req.url || "").split("?")[0];
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const send = (obj) => {
        const out = Buffer.from(JSON.stringify(obj));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": out.length });
        res.end(out);
      };
      if (url.endsWith("/login")) return send({ access_token: "stub-token" });
      if (url.endsWith("/agent/command/execute")) {
        seen.push(body);
        return send({ message: "", ok: true });
      }
      send({ message: "", ok: true });
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, seen })));
}

class Client {
  constructor(child) {
    this.child = child; this.nextId = 1; this.pending = new Map(); let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        const r = this.pending.get(msg.id);
        if (r) { this.pending.delete(msg.id); r(msg.result ?? msg); }
      }
    });
  }
  request(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("timeout " + method)), 20000);
      this.pending.set(id, (r) => { clearTimeout(t); res(r); });
    });
  }
}

test("a caller's {command:…} reaches the agent as cmd_params", async () => {
  const { server, seen } = await stubTeamserver();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ADAPTIX_ENDPOINT: `http://127.0.0.1:${server.address().port}/ts`,
           ADAPTIX_USERNAME: "operator", ADAPTIX_PASSWORD: "stub" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new Client(child);
  try {
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const res = await client.request("tools/call", {
      name: "adaptix_agent_command_execute",
      arguments: { agent_id: "abc", cmdline: "shell", data: JSON.stringify({ command: "whoami" }) },
    });
    assert.strictEqual(seen.length, 1, "exactly one execute request");
    const data = JSON.parse(seen[0].data ?? seen[0].Data ?? "{}");
    assert.strictEqual(data.cmd_params, "whoami", "the agent's key, not the caller's alias");
    const payload = JSON.parse(res.content[0].text);
    assert.strictEqual(payload.translated_from, "command");
  } finally {
    child.kill("SIGKILL");
    server.close();
  }
});
