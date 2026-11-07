import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LIVE_RUN_GAP_MS, mayRun, stamp } from "../tools/live-budget.mjs";

function freshStampDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ytfree-stamps-"));
  process.env.YTFREE_STAMP_DIR = dir;
  return dir;
}

test("a live run is allowed once per 24 hours, and --force overrides", () => {
  freshStampDir();
  const t = Date.UTC(2026, 10, 7, 20);
  assert.equal(mayRun("smoke", t).ok, true, "never run: allowed");
  stamp("smoke", t);
  const again = mayRun("smoke", t + LIVE_RUN_GAP_MS - 1);
  assert.equal(again.ok, false);
  assert.equal(again.next, t + LIVE_RUN_GAP_MS);
  assert.equal(mayRun("smoke", t + LIVE_RUN_GAP_MS).ok, true, "a day later: allowed");
  assert.equal(mayRun("smoke", t + 1, true).ok, true, "--force");
  assert.equal(mayRun("hd-probe", t + 1).ok, true, "each name has its own day");
});

test("npm run smoke stops before any request when today's run is spent", () => {
  const dir = freshStampDir();
  stamp("smoke");
  const result = spawnSync(process.execPath, ["tools/smoke.mjs"], {
    env: { ...process.env, YTFREE_STAMP_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /already ran in the last 24 hours/);
});
