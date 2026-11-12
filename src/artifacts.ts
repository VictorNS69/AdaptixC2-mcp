// Artifact naming for agent builds.
//
// The teamserver returns one filename per generate (its own build name, the
// same for every host of the same agent/format). Writing that name straight
// into ADAPTIX_OUTPUT_DIR means the second host's build overwrites the first —
// measured shape: four targets, one file left on disk — and nothing in the
// result says which artifact belongs to which host, so a delivery step cannot
// be scripted either. `artifactPath` folds an optional operator label (the
// target IP or hostname) into the name and never returns a path that already
// exists.

import fs from "node:fs";
import path from "node:path";

const UNSAFE = /[^A-Za-z0-9._-]+/g;

/** A label safe for a filename: no separators, no spaces, bounded length. */
export function sanitizeLabel(label: string): string {
  return String(label ?? "")
    .trim()
    .replace(UNSAFE, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "")
    .slice(0, 48);
}

/**
 * Free path for a build inside `dir`.
 *
 * `fileName` comes from the teamserver; `label` is the operator's tag for the
 * host it is meant for. Collision policy is append-a-counter, never overwrite:
 * losing a built artifact silently is worse than an ugly name.
 */
export function artifactPath(dir: string, fileName: string, label = ""): string {
  const clean = path.basename(String(fileName || "agent.bin"));
  const ext = path.extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || "agent";
  const tag = sanitizeLabel(label);
  const base = tag ? `${stem}-${tag}` : stem;
  let candidate = path.join(dir, `${base}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n += 1) {
    if (n > 9999) {
      throw new Error(`no free artifact name next to ${path.join(dir, `${base}${ext}`)}`);
    }
    candidate = path.join(dir, `${base}-${n}${ext}`);
  }
  return candidate;
}
