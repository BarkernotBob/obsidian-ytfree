/**
 * YouTube sign-in is removed (GitHub #64): no cookies ever reach the plugin,
 * and the first load after the update erases what an older version stored.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { legacyCookieFile, removeLegacySignIn } from "../src/desktop/legacy-signin.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : full.endsWith(".ts") ? [full] : [];
  });
}

test("nothing in the plugin passes cookies to yt-dlp or opens a sign-in window", () => {
  for (const file of sources("src")) {
    const text = readFileSync(file, "utf8");
    assert.ok(!text.includes('"--cookies"'), `${file} passes --cookies`);
    assert.ok(!text.includes("--cookies-from-browser"), `${file} reads browser cookies`);
    assert.ok(!/createElement\("webview"\)/.test(text), `${file} opens a webview`);
  }
});

test("the old cookie file is found where older versions wrote it", () => {
  assert.equal(
    legacyCookieFile(""),
    join(homedir(), "Library", "Application Support", "obsidian-ytfree", "cookies.txt"),
  );
  assert.equal(legacyCookieFile("~/x/cookies.txt"), join(homedir(), "x/cookies.txt"));
  assert.equal(legacyCookieFile(" /tmp/c.txt "), "/tmp/c.txt");
});

test("the old cookie file is deleted, and a missing one is not an error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ytfree-legacy-"));
  const file = join(dir, "cookies.txt");
  writeFileSync(file, "# Netscape HTTP Cookie File\n");
  assert.equal(await removeLegacySignIn(file), true);
  assert.equal(existsSync(file), false);
  assert.equal(await removeLegacySignIn(file), false);
});
