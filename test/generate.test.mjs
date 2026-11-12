// A rejected build must never look like a built artifact.
//
// Measured 2026-11-12 against AdaptixC2 v1.2: /agent/generate answers HTTP 200
// with {ok:false, message:"json: cannot unmarshal JSON number into
// GenerateConfig.sleep of Go type string"}. The old client split that message
// on its first colon and base64-decoded both halves, so a failed build wrote a
// 46-byte file with a mojibake name and reported ok:true — a payload that would
// never run, discovered only on the target.

import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = join(here, "..", "dist", "index.js");
const PAYLOAD = Buffer.from("MZfake-beacon-binary");

function stubTeamserver() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const url = (req.url || "").split("?")[0];
      const send = (obj) => {
        const out = Buffer.from(JSON.stringify(obj));
        res.writeHead(200, { "Content-Type": "application/json", "Content-Length": out.length });
        res.end(out);
      };
      if (url.endsWith("/login")) return send({ access_token: "stub-token" });
      if (url.endsWith("/listener/list")) return send([{ l_name: "ctf-http", l_status: "Listen" }]);
      if (url.endsWith("/agent/list")) return send(null);
      if (url.endsWith("/agent/generate")) {
        if (String(body.config).includes("bad-sleep")) {
          return send({
            ok: false,
            message: "json: cannot unmarshal JSON number into GenerateConfig.sleep of Go type string",
          });
        }
        const name = Buffer.from("agent.x64.exe").toString("base64");
        return send({ ok: true, message: `${name}:${PAYLOAD.toString("base64")}` });
      }
      send({ message: "not found", ok: false });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

class Client {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const resolve = this.pending.get(msg.id);
        if (resolve) { this.pending.delete(msg.id); resolve(msg.result ?? msg); }
      }
    });
  }
  request(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 20000);
      this.pending.set(id, (r) => { clearTimeout(t); resolve(r); });
    });
  }
  async call(name, args) {
    const result = await this.request("tools/call", { name, arguments: args });
    return { isError: result.isError === true, text: result.content[0].text, json: safe(result.content[0].text) };
  }
}

const safe = (t) => { try { return JSON.parse(t); } catch { return null; } };

function startMcp(endpoint, outputDir) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      ADAPTIX_ENDPOINT: endpoint,
      ADAPTIX_USERNAME: "operator",
      ADAPTIX_PASSWORD: "stub",
      ADAPTIX_OUTPUT_DIR: outputDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Client(child);
}

test("a rejected build fails with the teamserver's reason and writes no file", async () => {
  const server = await stubTeamserver();
  const out = mkdtempSync(join(tmpdir(), "adaptix-gen-"));
  const client = startMcp(`http://127.0.0.1:${server.address().port}/ts`, out);
  try {
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const bad = await client.call("adaptix_agent_generate", {
      agent: "beacon", listener_name: "ctf-http", config: "{\"sleep\":\"bad-sleep\"}", label: "10.10.10.7",
    });
    assert.strictEqual(bad.isError, true);
    assert.match(bad.text, /generate failed/);
    assert.match(bad.text, /GenerateConfig\.sleep/);
    assert.deepStrictEqual(readdirSync(out), [], "no artifact from a failed build");
  } finally {
    client.child.kill("SIGKILL");
    server.close();
  }
});

test("two builds for two hosts are two real files, and a repeat never overwrites", async () => {
  const server = await stubTeamserver();
  const out = mkdtempSync(join(tmpdir(), "adaptix-gen-"));
  const client = startMcp(`http://127.0.0.1:${server.address().port}/ts`, out);
  try {
    await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const args = (label) => ({ agent: "beacon", listener_name: "ctf-http", config: "{\"sleep\":\"5\"}", label });
    const first = await client.call("adaptix_agent_generate", args("10.10.10.5"));
    const second = await client.call("adaptix_agent_generate", args("10.10.10.6"));
    assert.strictEqual(first.isError, false);
    assert.strictEqual(first.json.fileName, "agent.x64-10.10.10.5.exe");
    assert.strictEqual(second.json.fileName, "agent.x64-10.10.10.6.exe");
    assert.ok(existsSync(first.json.path) && existsSync(second.json.path));
    assert.deepStrictEqual(readFileSync(first.json.path), PAYLOAD);
    const again = await client.call("adaptix_agent_generate", args("10.10.10.5"));
    assert.strictEqual(again.json.fileName, "agent.x64-10.10.10.5-2.exe", "a repeated label must not clobber the first file");
    assert.strictEqual(readdirSync(out).length, 3);
  } finally {
    client.child.kill("SIGKILL");
    server.close();
  }
});
