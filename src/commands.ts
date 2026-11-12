// Agent command argument names.
//
// The teamserver forwards a task's `Data` blob to the agent, and each command
// parses its OWN key names — they are not uniform and were not documented
// anywhere a caller could see. Measured 2026-11-12 against the v1.2 beacon:
// `shell` and `powershell` take `cmd_params`, `cat`/`cd`/`ls` take `path`,
// `download` takes `file`, `cp`/`mv` take `src`+`dst`. Sending anything else
// (including the obvious `{"command": "whoami"}`) reaches the agent as
// `cmd /c undefined` and the task silently runs nothing.
//
// This module normalizes the caller's payload so the natural keys work, and
// fails loudly when a required argument is missing instead of letting the
// server tell the operator "'undefined' is not recognized".

/** Primary string argument per command, from the agent extender's registry. */
const PRIMARY_ARG: Record<string, string> = {
  shell: "cmd_params",
  powershell: "cmd_params",
  cat: "path",
  cd: "path",
  ls: "path",
  mkdir: "path",
  download: "file",
};

/** Commands with a second required argument. */
const SECONDARY_ARGS: Record<string, string[]> = {
  cp: ["src", "dst"],
  mv: ["src", "dst"],
};

/** Keys a caller plausibly reaches for when it means "the command line". */
const LINE_ALIASES = ["command", "cmd", "args", "cmdline", "commandline", "line"];

export interface NormalizedCommand {
  data: string;
  /** Present when an alias was translated, so the caller can see what happened. */
  translatedFrom?: string;
  /** Present when the command is unknown to this table (passed through verbatim). */
  warning?: string;
}

function decode(data: string): { obj: Record<string, unknown> | null; raw: string } {
  const raw = (data ?? "").trim();
  if (raw === "" || raw === "{}") return { obj: {}, raw: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { obj: parsed as Record<string, unknown>, raw };
    }
  } catch {
    /* not JSON — treat as the command line itself */
  }
  return { obj: null, raw };
}

/**
 * Turn a caller's `data` into the payload the agent expects.
 *
 * - JSON with the correct key: unchanged.
 * - JSON with an obvious alias (`command`, `cmd`, `args`, `cmdline`): copied to
 *   the command's real argument name.
 * - A bare string: becomes the command's primary argument.
 * - Missing the required argument: throws, naming the command and the key.
 */
export function normalizeCommandArgs(cmdline: string, data: string): NormalizedCommand {
  const cmd = (cmdline ?? "").trim().toLowerCase();
  const primary = PRIMARY_ARG[cmd];
  const secondary = SECONDARY_ARGS[cmd] ?? [];

  if (!primary) {
    const passthrough = (data ?? "{}").trim() || "{}";
    return {
      data: passthrough,
      warning: `command '${cmdline}' is not in this server's argument table; its data is passed through verbatim — if the task reports 'undefined', the agent expects a different key`,
    };
  }

  const { obj, raw } = decode(data);
  if (obj === null) {
    if (raw === "") throw new Error(`${cmdline}: data is required (the ${primary} argument)`);
    return { data: JSON.stringify({ [primary]: raw }), translatedFrom: "bare-string" };
  }

  const out: Record<string, unknown> = { ...obj };
  const hasPrimary = typeof out[primary] === "string" && String(out[primary]).trim() !== "";

  for (const alias of LINE_ALIASES) {
    if (hasPrimary) break;
    const value = out[alias];
    if (typeof value === "string" && value.trim() !== "") {
      out[primary] = value.trim();
      delete out[alias];
      return { data: JSON.stringify(out), translatedFrom: alias };
    }
  }

  if (!hasPrimary) {
    const expected = secondary.length ? `${primary} (and ${secondary.join(", ")})` : primary;
    throw new Error(
      `${cmdline}: missing the ${expected} argument — the agent expects it by that name, not "command"/"cmd". ` +
        `Known names: ${Object.entries(PRIMARY_ARG)
          .map(([k, v]) => `${k}→${v}`)
          .join(", ")}.`,
    );
  }

  return { data: JSON.stringify(out) };
}
