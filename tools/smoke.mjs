/**
 * `npm run smoke` and `npm run smoke:full`: the live tests, under the daily
 * budget (GitHub #39). The limit is checked here, before node's test runner
 * starts, because test files cannot see `--force` on the command line.
 *
 *   node tools/smoke.mjs [--full] [--force]
 */
import { spawnSync } from "node:child_process";
import { mayRun, stamp } from "./live-budget.mjs";

const full = process.argv.includes("--full");
const force = process.argv.includes("--force");
const name = full ? "smoke-full" : "smoke";
const files = full ? ["tests/live/full.live.ts", "tests/live/channel.live.ts"] : ["tests/canary.smoke.ts"];

const verdict = mayRun(name, Date.now(), force);
if (!verdict.ok) {
  console.log(
    `${name}: already ran in the last 24 hours on this machine. Next run after ` +
      `${new Date(verdict.next).toLocaleString()}, or run it with -- --force.`,
  );
  process.exit(0);
}
stamp(name);

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
console.log(
  full
    ? `${name}: the full suite sends dozens of requests across several app identities.`
    : `${name}: about 5 requests to YouTube (1 yt-dlp run, 2 byte-range reads).`,
);
process.exit(result.status ?? 1);
