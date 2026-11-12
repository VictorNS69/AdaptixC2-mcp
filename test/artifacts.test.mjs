// Artifact naming: one build per host, no overwrite, no ambiguity.
//
// The teamserver names every build the same (agent.exe), so a four-host run
// used to leave one file on disk and no way to tell which host it was for.

import test from "node:test";
import assert from "node:assert";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "artifacts.js");
const { artifactPath, sanitizeLabel } = await import(pathToFileURL(DIST).href);

const dir = () => mkdtempSync(join(tmpdir(), "adaptix-artifacts-"));

test("the label is folded into the name, extension kept", () => {
  const d = dir();
  assert.equal(artifactPath(d, "agent.exe", "10.10.10.5"), join(d, "agent-10.10.10.5.exe"));
  assert.equal(artifactPath(d, "beacon.elf", "box4"), join(d, "beacon-box4.elf"));
});

test("no label keeps the teamserver name", () => {
  const d = dir();
  assert.equal(artifactPath(d, "agent.exe"), join(d, "agent.exe"));
});

test("a held name gets a counter, never an overwrite", () => {
  const d = dir();
  const first = artifactPath(d, "agent.exe", "10.10.10.5");
  writeFileSync(first, "first");
  const second = artifactPath(d, "agent.exe", "10.10.10.5");
  assert.equal(second, join(d, "agent-10.10.10.5-2.exe"));
  writeFileSync(second, "second");
  assert.equal(artifactPath(d, "agent.exe", "10.10.10.5"), join(d, "agent-10.10.10.5-3.exe"));
  // four hosts, four distinct files, nothing clobbered
  writeFileSync(artifactPath(d, "agent.exe"), "unlabelled");
  assert.deepStrictEqual(readdirSync(d).sort(), [
    "agent-10.10.10.5-2.exe",
    "agent-10.10.10.5.exe",
    "agent.exe",
  ]);
});

test("labels are sanitized: no separators, spaces or leading dots", () => {
  assert.equal(sanitizeLabel("../../etc/passwd"), "etc-passwd");
  assert.equal(sanitizeLabel("host one"), "host-one");
  assert.equal(sanitizeLabel("  .hidden  "), "hidden");
  assert.equal(sanitizeLabel("a".repeat(80)).length, 48);
  const d = dir();
  assert.equal(artifactPath(d, "agent.exe", "../x/y z"), join(d, "agent-x-y-z.exe"));
});

test("a name with no extension still gets one file per host", () => {
  const d = dir();
  assert.equal(artifactPath(d, "agent", "10.10.10.5"), join(d, "agent-10.10.10.5"));
  assert.equal(artifactPath(d, "agent", "10.10.10.6"), join(d, "agent-10.10.10.6"));
});
