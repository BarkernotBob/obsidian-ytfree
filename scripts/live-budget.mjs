/**
 * The budget every live tool and the smoke canary run under (GitHub #39).
 *
 * On 2026-11-04 probes and smoke runs from Isaiah's Mac, many identities and
 * many reads per video, got his home IP bot-flagged. So a live run is allowed
 * once per 24 hours per name on a machine, unless `--force` is passed, and it
 * prints how many requests it sent when it ends.
 *
 *   import { liveGuard } from "./live-budget.mjs";
 *   const budget = liveGuard("hd-probe");      // exits if already run today
 *   budget.ytDlp();                            // count a yt-dlp run by hand
 *
 * `fetch` is counted automatically. A yt-dlp run is several requests inside
 * yt-dlp; it is counted as one run, and said so.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LIVE_RUN_GAP_MS = 24 * 3600_000;

/** Where the stamps live: `~/.cache/ytfree/`, or `YTFREE_STAMP_DIR` (tests). */
export function stampDir() {
  return process.env.YTFREE_STAMP_DIR || join(homedir(), ".cache", "ytfree");
}

/**
 * Whether a live run called `name` may go now. Pure apart from the file: a
 * missing or unreadable stamp means "never run".
 */
export function mayRun(name, now = Date.now(), force = false) {
  if (force) return { ok: true };
  let last = NaN;
  try {
    last = Number(readFileSync(join(stampDir(), `${name}.stamp`), "utf8"));
  } catch {
    // never run here
  }
  if (Number.isFinite(last) && now - last < LIVE_RUN_GAP_MS) {
    return { ok: false, next: last + LIVE_RUN_GAP_MS };
  }
  return { ok: true };
}

/** Record a run as started. Stamped before any request: a failed run still cost them. */
export function stamp(name, now = Date.now()) {
  mkdirSync(stampDir(), { recursive: true });
  writeFileSync(join(stampDir(), `${name}.stamp`), String(now));
}

/**
 * Claim today's run for `name` or exit, then count requests until the
 * process ends. `--force` anywhere in argv skips the daily limit.
 */
export function liveGuard(name, argv = process.argv) {
  const force = argv.includes("--force");
  const verdict = mayRun(name, Date.now(), force);
  if (!verdict.ok) {
    console.log(
      `${name}: already ran in the last 24 hours on this machine. Next run after ` +
        `${new Date(verdict.next).toLocaleString()}, or pass --force.`,
    );
    process.exit(0);
  }
  stamp(name);

  const counts = { fetch: 0, ytDlp: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    counts.fetch += 1;
    return realFetch(...args);
  };
  process.on("exit", () => {
    console.log(
      `${name}: sent ${counts.fetch} HTTP request${counts.fetch === 1 ? "" : "s"} and ` +
        `${counts.ytDlp} yt-dlp run${counts.ytDlp === 1 ? "" : "s"} (each run is several requests inside yt-dlp).`,
    );
  });
  return { ytDlp: () => (counts.ytDlp += 1), counts };
}
