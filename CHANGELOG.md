# Changelog

Versions below are this project's.

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
