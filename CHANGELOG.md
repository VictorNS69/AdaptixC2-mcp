# Changelog

Versions below are this project's.

## 0.3.1 — 2026-11-18

Linked beacons, and a way to see why a command did not run.

### Added

- `adaptix_agent_raw_command` — run a full command line through
  `POST /agent/command/raw`. The server parses the line
  (`TsAxScriptParseAndExecute`) and returns a validation error in `message`,
  which `/agent/command/execute` does not: that endpoint answers
  `{ok:true, message:""}` even when nothing was dispatched. Measured on
  `link smb <host> <pipe>` — no task, no error, only the raw path says why.
- `adaptix_agent_link` — link a parent agent to a child pivot beacon
  (`link smb <target> <pipename>` / `link tcp <target> <port>`), then verify
  against `/agent/list` that a new agent appeared referencing the parent. A
  linked child receives commands THROUGH the parent, so it renders chained in
  the Sessions Graph, and its transport does not depend on a reverse port
  forward that dies with the parent session.

### Added

- Subcommand argument table for `rportfwd`, `socks` and `link`. These cannot be
  driven positionally through `/agent/command/raw` — measured 2026-11-19,
  `socks start 1080` parses the subcommand as the port and a JSON body without
  a `command` key is rejected with "'command' must be set". `execute` now takes
  either a natural line (`rportfwd start 12099 10.10.108.146 5985`) or the
  explicit object (`{"command":"rportfwd","subcommand":"start","lport":…,
  "fwdhost":…,"fwdport":…}`), validates the argument count and port range, and
  names the offending argument instead of forwarding `'undefined'`.

### Fixed

- `adaptix_agent_link` verification. The first implementation looked for the
  parent id, or `pipe`/`link`, inside `a_external_ip` — a field a linked child
  never fills. Measured 2026-11-19 against a live v1.2 teamserver: the link
  worked (parent `ec611833` → child `4f6c478f`, DC01, `dcsmb.exe`, SYSTEM,
  `shell` returned `nt authority\system` / `DC01`) while the tool reported
  `verified_linked_agent: null`. It now takes a before/after `/agent/list`
  diff, matches the new record against the target, and falls back to the
  parent task message `[<parent>]===[<child>]`. The response carries
  `verified`, `detected_by`, `linked_agent` and `link_evidence`.
- A linked child's `a_last_tick` stays at its registration time and is not a
  liveness signal; the tool description and its response `note` say so,
  because reading the tick as "registered but dead" was the previous
  conclusion drawn from it.

### Notes

- `link` opens a session rather than creating a task row, so "no task in
  `adaptix_task_list`" is not evidence of failure — the agent list is the only
  honest verification, which is what `adaptix_agent_link` reports.

## 0.3.0 — 2026-11-12

Multi-host operation: a beacon on every host, without losing a build.

### Added

- `adaptix_agent_wait` — poll `/agent/list` until `expected` agents are
  present, optionally only those matching an IP/hostname (`match`). A timeout
  returns `ok:false` with the count and the agents it did see.
- `adaptix_agent_generate` takes `label`: the target IP/hostname is folded into
  the artifact filename (`beacon-10.10.10.5.elf`) and a taken name gets `-2`,
  `-3` instead of being overwritten. The result carries `fileName`,
  `serverFileName`, `label` and `path`.
- `src/artifacts.ts` — filename/label handling, unit-tested.
- `adaptix_listener_create` verifies the listener appears in `/listener/list`
  before reporting success, and fails with the teamserver's own message
  otherwise.
- Listener lifecycle (`stop`, `pause`, `resume`, `edit`), `adaptix_agent_generate`,
  `adaptix_agent_command_execute`, `adaptix_agent_remove`, `adaptix_task_cancel`,
  `adaptix_task_delete` — the surface itself lands in this version; the
  changelog had stopped at 0.2.0 while the tools kept arriving.
- README/USAGE: the four-host runbook, the 17-tool table, the mutating
  endpoints, and an honest status note (the scope gate is still not
  implemented).

### Changed

- README no longer calls the server a read-only scaffold.

## 0.2.0 — 2026-11-11

Artifact surface: generate agents and start listeners over the REST API.

### Added

- `adaptix_listener_create` — start a listener (`POST /listener/create`) with a
  JSON-string config.
- `adaptix_agent_generate` — build an agent artifact (`POST /agent/generate`),
  decode the base64 `fileName:content` payload, and write the binary to
  `ADAPTIX_OUTPUT_DIR`.
- `ADAPTIX_OUTPUT_DIR` config for the artifact output directory.
- Smoke test now asserts the eight-tool surface.

## 0.1.0 — 2026-11-11

Initial scaffold. Read-only recon surface over the AdaptixC2 v1.2 REST API.

### Added

- Repository layout: `package.json`, `tsconfig.json`, `LICENSE`, `.gitignore`,
  `.github/` (Dependabot + a stdio test workflow).
- `README.md`, `SECURITY.md`, `USAGE.md` documenting the intended design: scope
  gate + confirmed checkpoint + observer UI, mirroring the ligolo-ng-mcp
  reference.
- `src/adaptix.ts` — API client: login (JWT, version-pinned) and the read-only
  endpoints (`agent/list`, `listener/list`, `agent/task/list`, `targets/list`,
  `creds/list`), with self-signed TLS support (`ADAPTIX_CA` /
  `ADAPTIX_TLS_INSECURE`).
- `src/index.ts` — six read-only MCP tools (`adaptix_server_status`,
  `adaptix_agent_list`, `adaptix_listener_list`, `adaptix_task_list`,
  `adaptix_targets_list`, `adaptix_creds_list`).
- `test/` — a stdio smoke suite that asserts the read-only tool surface without
  a teamserver.

### Not yet implemented

Command execution, the scope gate (`ADAPTIX_SCOPE`), the confirmed checkpoint,
the command allowlist, read-only mode, and the observer UI. They are documented
in README §The execution gate as the next milestone.
