# Changelog

Versions below are this project's.

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
