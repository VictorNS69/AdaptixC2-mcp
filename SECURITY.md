# Security

## Scope of use

This server drives AdaptixC2, a post-exploitation framework. Use it only where
you are authorized: a signed engagement, a bug-bounty program's published
scope, or infrastructure you own. Authorization is yours, never implied by
"an agent is connected" or by this server.

## Supported versions

| AdaptixC2 | Supported |
|---|---|
| 1.2.x | yes (the target of this server) |
| testing-v2.0 | no (unreleased; the REST surface differs) |

The teamserver's REST API is not documented upstream as stable. An endpoint or
payload change in a future Adaptix release can break this server silently; pin
the teamserver to v1.2 and verify `adaptix_server_status` reports the version
you expect.

## Threat model

The teamserver is a control plane: an operator's JWT can enumerate, execute,
pivot and exfiltrate. The MCP holds that token, so the MCP process is as
powerful as the operator account it logs in with.

The intended mitigations below would all be enforced in this server, before a
request leaves the process. **None of them is implemented as of 0.3.0**: the
mutating tools (listener lifecycle, artifact generation, command execution,
agent cleanup) call the teamserver directly, so authorization has to come from
the client that runs this MCP.

- **Scope allowlist** (`ADAPTIX_SCOPE`, planned): agents/targets the MCP may
  touch. Everything else fails closed.
- **Confirmed checkpoint** (planned): pivots and port-forwards require a target
  in scope plus `confirmed: true`.
- **Command allowlist** (planned): no arbitrary raw-console execution by
  default — a bounded set, with the raw path default-deny.
- **Read-only mode** (`ADAPTIX_MCP_READ_ONLY`, planned): registers only the
  read-only tools.

Do not rely on the teamserver's own authorization, which is coarse (operators
plus a password) and shared by every client including the GUI.

## TLS

The teamserver serves HTTPS with a self-signed certificate by default. Two
options, in order of preference:

- `ADAPTIX_CA=/path/to/server.rsa.crt` — trust that exact certificate bundle.
- `ADAPTIX_TLS_INSECURE=1` — accept any certificate. Debug only; it defeats
  server authentication entirely.

There is no safe default here: without one of the two the handshake fails,
which is intentional.

## Credentials

`ADAPTIX_PASSWORD` is read once from the environment, held in memory, and never
logged or returned by any tool. Do not commit it, and do not put the
teamserver's `profile.yaml` (which stores the operator hash) in this
repository — both are gitignored.

## Reporting a vulnerability

Open an issue at https://github.com/VictorNS69/AdaptixC2-mcp/issues, or reach
out directly to the maintainer. Do not open a public issue with a working
exploit against the teamserver; report the MCP-side flaw first.
