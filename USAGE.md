# Usage

Operational walkthrough for this MCP server: what to call, in what order, what
comes back, and what stays your job. Reference material lives in
[README.md](README.md); this file is the "work a teamserver" path.

Assumes the server is installed (`npm install && npm run build`) and you have a
running AdaptixC2 v1.2 teamserver with operator credentials. **Check the
version-compatibility warning at the top of the README first.**

> **0.1.0 scope.** The current tools are read-only (recon). Command execution
> and the execution gate are the next milestone, so this walkthrough covers the
> recon loop and the raw API by hand; the mutating sections land with those
> tools.

Contents: [Before the first call](#before-the-first-call) · [Register the
server](#register-the-server) · [Walkthrough: recon](#walkthrough-recon) ·
[Reading the responses](#reading-the-responses) · [Raw API by hand](#raw-api-by-hand)

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

Nothing mutates in `0.1.0`: this loop is safe to run against a live engagement
without changing state.

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

## Raw API by hand

The read-only tools are thin wrappers; the same calls work with `curl` once you
have a token:

```bash
TOKEN=$(curl -sk https://127.0.0.1:4321/endpoint/login   -H 'Content-Type: application/json'   -d '{"username":"operator","password":"...","version":"v1.2"}' | jq -r .access_token)

curl -sk https://127.0.0.1:4321/endpoint/agent/list -H "Authorization: Bearer $TOKEN"
curl -sk "https://127.0.0.1:4321/endpoint/agent/task/list?agent_id=<id>&limit=100&offset=0"   -H "Authorization: Bearer $TOKEN"
```

The full endpoint map is in README §HTTP endpoints used.
