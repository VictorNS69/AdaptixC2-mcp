// Command argument normalization.
//
// Measured 2026-11-12: the v1.2 beacon's `shell` parses `cmd_params`, so the
// documented {"command":"whoami"} reached the agent as `cmd /c undefined` and
// the task silently ran nothing. These tests pin the translation table and the
// loud failure when an argument is missing.

import test from "node:test";
import assert from "node:assert";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "commands.js");
const { normalizeCommandArgs } = await import(pathToFileURL(DIST).href);

test("shell takes cmd_params, and an obvious alias is translated", () => {
  const r = normalizeCommandArgs("shell", JSON.stringify({ command: "whoami" }));
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "whoami" });
  assert.strictEqual(r.translatedFrom, "command");
  for (const alias of ["cmd", "args", "cmdline", "commandline"]) {
    const a = normalizeCommandArgs("shell", JSON.stringify({ [alias]: "id" }));
    assert.deepStrictEqual(JSON.parse(a.data), { cmd_params: "id" }, alias);
  }
});

test("the correct key passes through untouched", () => {
  const r = normalizeCommandArgs("shell", JSON.stringify({ cmd_params: "whoami /all" }));
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "whoami /all" });
  assert.strictEqual(r.translatedFrom, undefined);
});

test("a bare string becomes the primary argument", () => {
  const r = normalizeCommandArgs("shell", "whoami");
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "whoami" });
  assert.strictEqual(r.translatedFrom, "bare-string");
  const c = normalizeCommandArgs("cat", "C:\\\\Windows\\\\win.ini");
  assert.deepStrictEqual(JSON.parse(c.data), { path: "C:\\\\Windows\\\\win.ini" });
});

test("a missing required argument fails loudly instead of running `undefined`", () => {
  assert.throws(() => normalizeCommandArgs("shell", "{}"), /missing the cmd_params argument/);
  assert.throws(() => normalizeCommandArgs("shell", ""), /missing the cmd_params argument/);
  assert.throws(() => normalizeCommandArgs("cat", "{}"), /cat→path|missing the path/);
});

test("powershell uses the same cmd_params key", () => {
  const r = normalizeCommandArgs("powershell", JSON.stringify({ command: "Get-Process" }));
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "Get-Process" });
});

test("an unknown command passes through with a warning, never a guess", () => {
  const r = normalizeCommandArgs("frobnicate", "1234");
  assert.strictEqual(r.data, "1234");
  assert.match(r.warning, /not in this server's argument table/);
});

test("subcommand commands take a natural line and build the named Data shape", () => {
  // Measured 2026-11-19: these cannot be driven positionally through
  // /agent/command/raw — `socks start 1080` parses "start" as the port.
  const rp = normalizeCommandArgs("rportfwd", "start 12099 10.10.108.146 5985");
  assert.deepStrictEqual(JSON.parse(rp.data), {
    command: "rportfwd",
    subcommand: "start",
    lport: 12099,
    fwdhost: "10.10.108.146",
    fwdport: 5985,
  });
  assert.strictEqual(rp.translatedFrom, "line");

  const socks = normalizeCommandArgs("socks", "start 127.0.0.1 1080");
  assert.deepStrictEqual(JSON.parse(socks.data), {
    command: "socks",
    subcommand: "start",
    address: "127.0.0.1",
    port: 1080,
  });

  const link = normalizeCommandArgs("link", "smb 10.10.108.146 ms01pipe1");
  assert.deepStrictEqual(JSON.parse(link.data), {
    command: "link",
    subcommand: "smb",
    target: "10.10.108.146",
    pipename: "ms01pipe1",
  });
});

test("subcommand commands accept the explicit JSON shape too", () => {
  const r = normalizeCommandArgs(
    "rportfwd",
    JSON.stringify({ command: "rportfwd", subcommand: "start", lport: 12098, fwdhost: "10.10.108.146", fwdport: 445 }),
  );
  assert.deepStrictEqual(JSON.parse(r.data), {
    command: "rportfwd",
    subcommand: "start",
    lport: 12098,
    fwdhost: "10.10.108.146",
    fwdport: 445,
  });
});

test("subcommand commands fail loudly on a bad port, unknown subcommand, or missing argument", () => {
  assert.throws(() => normalizeCommandArgs("socks", "start 127.0.0.1 notaport"), /port.*1-65535/);
  assert.throws(() => normalizeCommandArgs("rportfwd", "bogus 1234"), /unknown subcommand 'bogus'/);
  assert.throws(() => normalizeCommandArgs("rportfwd", JSON.stringify({ subcommand: "start" })), /missing required argument 'lport'/);
  assert.throws(() => normalizeCommandArgs("link", "smb 10.10.108.146"), /expected 2 argument/);
});

test("extra keys survive the translation", () => {
  const r = normalizeCommandArgs("shell", JSON.stringify({ command: "whoami", timeout: "30" }));
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "whoami", timeout: "30" });
});
