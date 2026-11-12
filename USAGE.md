# Usage

Operational walkthrough for this MCP server: what to call, in what order, what
comes back, and what stays your job. Reference material lives in
[README.md](README.md); this file is the "work a teamserver" path.

Assumes the server is installed (`npm install && npm run build`) and you have a
running AdaptixC2 v1.2 teamserver with operator credentials. **Check the
version-compatibility warning at the top of the README first.**

> **0.3.0 scope.** 17 tools: recon plus listeners, artifact generation, command
> execution and cleanup. The **scope gate is still not implemented** — nothing
> in this server checks that an agent or target is authorized, so run it where
> something else does (an assessment framework's per-assessment opt-in, or a lab
> you own), and treat listener/agent/command calls as production changes.

Contents: [Before the first call](#before-the-first-call) · [Register the
server](#register-the-server) · [Walkthrough: recon](#walkthrough-recon) ·
[Walkthrough: the primitives, in order](#walkthrough-the-primitives-in-order) ·
[Reading the responses](#reading-the-responses) · [Raw API by
hand](#raw-api-by-hand)

## Before the first call

| Need | Why | Check |
|---|---|---|
| AdaptixC2 v1.2 teamserver, running | the server talks to it over HTTPS; nothing is vendored | `curl -k https://127.0.0.1:4321/endpoint` (expect a non-200, non-connection-refused answer — e.g. the server's error page) |
| operator credentials | every call is authenticated | the operator's username/password |
| TLS trust | the teamserver uses a self-signed cert | `ADAPTIX_CA=/path/to/server.rsa.crt`, or `ADAPTIX_TLS_INSECURE=1` for a lab |

That is all: no Adaptix checkout, no Qt, no external wrapper scripts.

## Register the server

Claude Code / any `.mcp.json` client:

```json
{
  "mcpServers": {
    "adaptixc2": {
      "command": "node",
      "args": ["/path/to/AdaptixC2-mcp/dist/index.js"],
      "env": {
        "ADAPTIX_ENDPOINT": "https://127.0.0.1:4321/endpoint",
        "ADAPTIX_USERNAME": "operator",
        "ADAPTIX_PASSWORD": "...",
        "ADAPTIX_CA": "/path/to/server.rsa.crt"
      }
    }
  }
}
```

## Walkthrough: recon

1. `adaptix_server_status` — proves auth and shows the pinned version. Fail
   here (wrong password, wrong endpoint, TLS) before anything else.
2. `adaptix_agent_list` — every connected beacon: id, host, user, OS, listener.
3. `adaptix_task_list` — pass an `agent_id` from step 2 to read that agent's
   completed tasks, including command output in `Text`.

Nothing here mutates: this loop is safe to run against a live engagement
without changing state.

## Walkthrough: the primitives, in order

A client (agent framework, script, operator) drives these in sequence; this
server adds no sequencing of its own.

1. **Connect.** `adaptix_server_status` — wrong password, wrong endpoint path or
   TLS trust fail here, before anything else.
2. **Listener.** `adaptix_listener_create {name, type:"BeaconHTTP", config:"…"}`
   with the extender's own config JSON. `verified: true` means the listener is
   in `/listener/list`; anything else is a refusal with the teamserver's reason
   (the teamserver answers HTTP 200 even when it rejects the config).
3. **Build.** `adaptix_agent_generate {agent, listener_name, config, label}`
   returns `path`, `fileName` and `bytes`; `label` (the target IP or hostname)
   is folded into the name so several builds never collide. A rejected build
   fails with the teamserver's reason and writes nothing.
4. **Prove it.** `adaptix_agent_wait {expected, match, timeout_s}` blocks until
   that many agents are present; `ok:false` carries the count it reached.
5. **Task.** `adaptix_agent_command_execute {agent_id, cmdline, data}`, with
   `wait_answer` for the inline result or `adaptix_task_list` after the fact.
6. **Cleanup.** `adaptix_agent_remove`, `adaptix_task_delete`,
   `adaptix_listener_stop`.

What is *not* here, on purpose: starting/stopping the teamserver, deciding which
hosts to touch, delivering the artifact to a host, and keeping an engagement
ledger. Those belong to the client — a tool that plans cannot be gated or
recorded by the thing that owns the engagement.

## Reading the responses

Every tool returns a JSON object in the first text block. On failure it is
`{"error":"failed","tool":"<name>","message":"<reason>"}` with `isError: true`
— so a refused request is never confused with an empty result.

Gotchas:

- A wrong password returns **HTTP 404 with an HTML page** (the teamserver's
  default error page), not a JSON error. `adaptix_server_status` reports it as
  `HTTP 404`.
- Task output is asynchronous. A command's result appears in
  `adaptix_task_list` only after the beacon has picked up the task and written
  the result back — poll, do not expect it on the first call.
- Listener and command calls answer **HTTP 200 even when they fail**, with
  `{ok, message}`. `adaptix_listener_create` verifies against
  `/listener/list` for that reason; for the rest, read `message` — a bare
  `{ok:true}` with no error text is the success shape.
- `adaptix_agent_wait` counts agents, not hosts: a host that re-beacons after a
  restart shows two agents until the old one is removed. Use `match` with the
  IP or hostname to make the count about the host you care about.

## Raw API by hand

The read-only tools are thin wrappers; the same calls work with `curl` once you
have a token:

```bash
TOKEN=$(curl -sk https://127.0.0.1:4321/endpoint/login   -H 'Content-Type: application/json'   -d '{"username":"operator","password":"...","version":"v1.2"}' | jq -r .access_token)

curl -sk https://127.0.0.1:4321/endpoint/agent/list -H "Authorization: Bearer $TOKEN"
curl -sk "https://127.0.0.1:4321/endpoint/agent/task/list?agent_id=<id>&limit=100&offset=0"   -H "Authorization: Bearer $TOKEN"
```

The full endpoint map is in README §HTTP endpoints used.
