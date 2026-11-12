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
  const r = normalizeCommandArgs("socks", "1234");
  assert.strictEqual(r.data, "1234");
  assert.match(r.warning, /not in this server's argument table/);
});

test("extra keys survive the translation", () => {
  const r = normalizeCommandArgs("shell", JSON.stringify({ command: "whoami", timeout: "30" }));
  assert.deepStrictEqual(JSON.parse(r.data), { cmd_params: "whoami", timeout: "30" });
});
