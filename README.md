# AdaptixC2 MCP server

An [Model Context Protocol](https://modelcontextprotocol.io) server for
[AdaptixC2](https://github.com/Adaptix-Framework/AdaptixC2): post-exploitation
in authorized security assessments, driven over the teamserver's authenticated
REST control plane while an operator watches the Adaptix GUI in parallel.

Every tool is a call against the teamserver's HTTP API (Gin + JWT). No Qt GUI
automation, no scraping a console, no per-command shell process. The MCP is
just another client of the teamserver — the same relationship the GUI has.

> [!WARNING]
> **Authorized use only.** This server drives AdaptixC2, a post-exploitation
> and adversarial-emulation framework. It is intended only for authorized
> security testing — a signed engagement, a bug-bounty program's published
> scope, or your own lab. Nothing here grants authorization. The execution
> gate (planned) exists precisely because "an agent is connected" is not
> "in scope".

> [!NOTE]
> **Status: 0.3.0 — 17 tools, recon plus a mutating surface.** Read-only
> recon (agents, listeners, tasks/output, targets, credentials); listener
> lifecycle (create/stop/pause/resume/edit); artifact generation; command
> execution; agent and task cleanup. The **scope-bound execution gate is still
> not implemented** (`ADAPTIX_SCOPE`, `ADAPTIX_MCP_READ_ONLY`, the confirmed
> checkpoint and the observer UI are the same planned design as in 0.1.0 —
> README §The execution gate). Until it lands, the trust boundary around the
> mutating tools is the client's, not this server's: run it where something
> else gates the calls (an assessment framework's opt-in, a lab you own).

```
MCP client ──stdio──> adaptixc2-mcp ──HTTPS REST + JWT──> Adaptix teamserver ──beacon──> agent
                          │
                          └─ execution gate (planned): agent/target in ADAPTIX_SCOPE
                             + confirmed, checked before any request leaves the process
```

Contents: [Why this](#why-this) · [Requirements](#requirements) · [Version
compatibility](#version-compatibility) · [Install](#install) · [Quick
start](#quick-start) · [Configuration](#configuration) · [Registering
it](#registering-it) · [Typical flow](#typical-flow) · [The execution
gate](#the-execution-gate) · [Tools](#tools) · [HTTP endpoints
used](#http-endpoints-used) · [Development](#development) · [Security
notes](#security-notes) · [What this server does not do](#what-this-server-does-not-do) ·
[License](#license)

## Why this

Several AdaptixC2 MCP servers already exist (Faceless0x7/AdaptixC2-MCP-Server,
s0ld13rr/adaptix-mcp, melnicek/adaptix-mcp). They are thin API wrappers: they
expose the REST endpoints and, in one case, the WebSocket sync channel, but none
enforces an authorization boundary — an agent holding the token can run anything
on any agent. This server exists to add the three safety layers the
ligolo-ng-mcp reference established, in the same TypeScript + Node shape:

- **scope gate** — an in-process allowlist of the agents/targets the MCP may
  touch, checked before any request leaves the process.
- **confirmed gate** — pivots and port-forwards require a target inside scope
  plus an explicit `confirmed: true`.
- **observer UI** — a read-only view so the operator watches while the agent
  drives.

## Requirements

- Node.js 20+
- a running AdaptixC2 **v1.2** teamserver (the server binary; nothing is
  vendored here — the MCP talks to it over HTTPS). The GUI client is optional
  and only useful for the operator watching in parallel.

Nothing else: no Adaptix checkout, no Qt, no local wrapper scripts.

## Version compatibility

This server targets **AdaptixC2 v1.2** (the latest stable release tag at the
time of writing; a `testing-v2.0` branch exists but is unreleased). The REST
API it depends on is not documented upstream as stable — like ligolo's, it can
rename or remove an endpoint, change a payload field, or alter auth without a
compatibility promise, which would break these tools, not Adaptix itself.

- Pin the teamserver to v1.2. The MCP sends `ADAPTIX_VERSION` (default
  `"v1.2"`) as the login `version` claim, but the server does not reject a
  mismatch — verify the teamserver reports v1.2 before trusting a green run.
- `npm test` validates this server, not upstream drift.

## Install

```bash
git clone git@github.com:VictorNS69/AdaptixC2-mcp.git
cd AdaptixC2-mcp
npm install
npm run build
```

## Quick start

```bash
export ADAPTIX_ENDPOINT="https://127.0.0.1:4321/endpoint"   # teamserver base URL incl. profile path
export ADAPTIX_USERNAME="operator"
export ADAPTIX_PASSWORD="..."
export ADAPTIX_CA="/path/to/teamserver/server.rsa.crt"      # self-signed cert; or ADAPTIX_TLS_INSECURE=1 (debug only)
node dist/index.js                                          # or register it in any MCP client
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ADAPTIX_ENDPOINT` | — | teamserver base URL incl. the profile endpoint path, e.g. `https://127.0.0.1:4321/endpoint` |
| `ADAPTIX_USERNAME` | `operator` | operator username |
| `ADAPTIX_PASSWORD` | — | operator password (required) |
| `ADAPTIX_VERSION` | `v1.2` | server version sent as the login `version` claim |
| `ADAPTIX_CA` | — | path to a PEM bundle to trust (the teamserver's self-signed `server.rsa.crt`) |
| `ADAPTIX_TLS_INSECURE` | off | `1` accepts any certificate — debug only, do not use in production |
| `ADAPTIX_SCOPE` | — | *(planned)* authorization allowlist of agents/targets |
| `ADAPTIX_MCP_READ_ONLY` | — | *(planned)* `1` registers only the read-only tools |

The password is held in memory only and is never logged or returned.

### Registering it

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

## Typical flow

Recon:

1. `adaptix_server_status` — confirm auth and the pinned version.
2. `adaptix_agent_list` — enumerate connected agents.
3. `adaptix_task_list` — read completed command output for an agent.

### Beacons on several hosts (the CTF shape: 4 targets, 4 agents)

The MCP does the C2 half of this; delivery to each host is yours (a web
listener, an SMB share, an existing shell). One loop per host, then one wait:

1. **One listener, once.** `adaptix_listener_create` with the type
   (`BeaconHTTP`, `GopherTCP`, …) and that type's config JSON. It returns
   `verified: true` only if `/listener/list` shows it. Name it for the
   engagement (`ctf-http`) — every build below names it.
2. **One artifact per host, labelled.** `adaptix_agent_generate`
   `{agent:"beacon", listener_name:"ctf-http", config:"{\"os\":\"linux\",\"arch\":\"amd64\",\"format\":\"elf\"}", label:"10.10.10.5"}`
   → `path: .../beacon-10.10.10.5.elf`. Repeat per host; no overwrite, no
   ambiguity. `output_dir` should be the assessment's own artifact directory.
3. **Deliver** each artifact to its host and execute it.
4. **Wait for check-in.** `adaptix_agent_wait {expected:1, match:"10.10.10.5"}`
   after each delivery, or `{expected:4}` once after the batch. It polls
   `/agent/list` and returns the agents it saw; a timeout is `ok:false` with the
   count, never a silent success. No check-in means the payload did not run,
   could not egress, or calls a different listener — `adaptix_listener_list`
   tells you which.
5. **Task them.** `adaptix_agent_command_execute {agent_id, cmdline:"shell",
   data:"{\"command\":\"id\"}", wait_answer:true}` for the inline answer, or
   `wait_answer:false` and read `adaptix_task_list` (output is asynchronous).
6. **Map agents to hosts** with `adaptix_agent_list`, and record the mapping:
   the same host re-beaconing after a restart gets a new id.
7. **Cleanup.** `adaptix_agent_remove {agent_ids:[...]}` for dead or finished
   beacons, `adaptix_task_delete` for their task history. Stopping the listener
   last (`adaptix_listener_stop`) keeps re-connects possible while you work.

Agent-side command names and their `data` shapes are Adaptix's, not this
server's: `shell`, `sleep`, `cat`, `cd`, `ps`, `socks`, `exit`, … A command the
agent does not implement comes back as a task error in `adaptix_task_list`.

## The execution gate

*(planned, not implemented. 0.1.0's read-only tools needed no gate; 0.3.0's
mutating tools do, and do not have one yet — see the status note above.)*

Command execution and reachability changes go through three layers, all
enforced in-process before a request leaves the MCP:

- **Scope.** `ADAPTIX_SCOPE` is an allowlist of the agent ids and target
  hosts/CIDRs the MCP may act on. A visible-but-unlisted agent or network is
  still out of scope.
- **Confirmation.** Pivots and port-forwards (new reachability) require a
  target inside scope plus `confirmed: true`, set only after a human approves
  the hop. The gate refuses until it is genuinely cleared.
- **Command allowlist.** Adaptix raw console can run anything — shell, BOF,
  execute-assembly. The MCP does not expose arbitrary command execution by
  default; it exposes a bounded set whose commands are safe to automate, and a
  raw path that stays default-deny.

## Tools

All 17 are always registered. `annotations.destructiveHint` marks the ones that
change teamserver state.

| Tool | Maps to | Purpose |
|---|---|---|
| `adaptix_server_status` | `POST /login` | confirm auth, endpoint and pinned version |
| `adaptix_agent_list` | `GET /agent/list` | list connected agents (beacons) |
| `adaptix_agent_wait` | `GET /agent/list` (polled) | wait until N agents check in, optionally only those matching an IP/hostname |
| `adaptix_listener_list` | `GET /listener/list` | listeners and their state |
| `adaptix_listener_create` | `POST /listener/create` | start a listener, then **verify** it appears in `/listener/list` |
| `adaptix_listener_stop` | `POST /listener/stop` | stop a listener |
| `adaptix_listener_pause` | `POST /listener/pause` | pause a listener |
| `adaptix_listener_resume` | `POST /listener/resume` | resume a listener |
| `adaptix_listener_edit` | `POST /listener/edit` | rewrite a listener's config |
| `adaptix_agent_generate` | `POST /agent/generate` | build an artifact; write it locally under a label, never overwriting |
| `adaptix_agent_command_execute` | `POST /agent/command/execute` | run an agent command, optionally waiting for its answer |
| `adaptix_agent_remove` | `POST /agent/remove` | remove agents (dead beacons, cleanup) |
| `adaptix_task_list` | `GET /agent/task/list` | completed tasks for an agent, with command output |
| `adaptix_task_cancel` | `POST /agent/task/cancel` | cancel queued tasks |
| `adaptix_task_delete` | `POST /agent/task/delete` | delete completed tasks |
| `adaptix_targets_list` | `GET /targets/list` | tracked targets |
| `adaptix_creds_list` | `GET /creds/list` | stored credentials |

Two behaviours worth knowing, both learned from the multi-host case:

- `adaptix_agent_generate` takes a `label` (the target IP or hostname) and folds
  it into the filename. The teamserver returns the same build name for every
  host, so without a label the second build overwrote the first and nothing
  said which artifact was for which host. It also refuses to overwrite: a taken
  name gets `-2`, `-3`, and the result carries `fileName`, `serverFileName`,
  `label` and `path`.
- `adaptix_listener_create` confirms the listener is actually in
  `/listener/list` before reporting success. The teamserver answers these calls
  with HTTP 200 and an `{ok, message}` body, so a rejected config used to read
  as a started listener — the failure that surfaces 20 minutes later as "no
  beacons ever arrived".

## HTTP endpoints used

The read-only tools map onto a small, stable slice of the AdaptixC2 v1.2 REST
surface (all JSON, all behind the JWT bearer token):

- `POST /login` — `{username, password, version}` returns
  `{access_token, refresh_token}`. Public.
- `GET /agent/list` — live agents.
- `GET /listener/list` — listeners.
- `GET /agent/task/list?agent_id=&limit=&offset=` — completed tasks, each with
  `TaskId`, `CmdLine`, `Message` and `Text` (the command output).
- `GET /targets/list` — targets.
- `GET /creds/list` — credentials.
- `POST /listener/create|stop|pause|resume|edit` — `{name, type, config?}`;
  answer is `{ok, message}` with HTTP 200 even when the listener was rejected.
- `POST /agent/generate` — `{agent, listener_name:[...], config}`; returns the
  artifact as `base64(fileName):base64(content)` in `message`.
- `POST /agent/command/execute` — `{id, cmdline, data, wait_answer, ui:false}`.
- `POST /agent/remove` — `{agent_id_array:[...]}`.
- `POST /agent/task/cancel|delete` — `{agent_id, tasks_array:[...]}`.

Command output is asynchronous: a command is enqueued on the agent, the beacon
picks it up, and the result is written back and surfaced through
`/agent/task/list`. The real-time alternative is the WebSocket sync channel
(`/connect` via OTP), which the MCP deliberately does not speak — polling the
task endpoint is enough for automation and avoids reimplementing the `axc2`
framing.

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # build + smoke test over stdio (no teamserver needed)
```

Layout: `src/adaptix.ts` is the API client (login + the read-only endpoints);
`src/index.ts` registers the MCP tools. `test/` is a stdio smoke suite.

## Security notes

See [SECURITY.md](SECURITY.md) for the threat model, the supported-version
policy and how to report a vulnerability.

In one line: the token the MCP holds is full operator power, so the boundary
between "recon" and "post-exploitation" is enforced in this server (scope +
confirmed + command allowlist), not delegated to the teamserver, whose own
authorization is coarse (operators + a password).

## What this server does not do

- It does not deliver an artifact to a host or execute it there — it builds the
  binary locally and writes it to `ADAPTIX_OUTPUT_DIR`; delivery and first
  execution are yours.
- It does not decide scope — there is no `ADAPTIX_SCOPE` check yet.
- It does not speak the WebSocket sync channel (real-time console) — output is
  read from the completed-task REST endpoint.
- It does not ship or link any Adaptix code; it only calls its HTTP API.

## License

MIT. © 2026 Víctor Nieves. AdaptixC2 is GPL-3.0 and is a separate prerequisite
you run yourself; no Adaptix code is vendored here.
