#!/usr/bin/env node
/**
 * GitHub #91: the hosted player page is served from the `gh-pages` branch
 * (`player/index.html`), not from main's `docs/player/index.html`. This fails
 * when the published copy matches neither this checkout's `docs/player/index.html`
 * nor main's, i.e. someone changed the page and didn't copy it to gh-pages.
 *
 * Accepting main's copy too lets a branch that edits the page pass once gh-pages
 * is synced to it, and lets every other branch pass while gh-pages matches main.
 *
 * Runs in `npm run check`. Without network on a Mac it warns and passes; in CI
 * (env CI set) a failed fetch is a failure, so a broken check can't pass quietly.
 *
 * To sync: copy docs/player/index.html to player/index.html on gh-pages, commit, push.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LOCAL = "docs/player/index.html";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const local = readFileSync(LOCAL, "utf8");

// One fetch into private refs. --depth only in an already-shallow clone (CI), so
// a full clone on the Mac is never cut down to one commit.
const shallow = git("rev-parse", "--is-shallow-repository").trim() === "true";
try {
  git(
    "fetch", "--quiet", "--no-tags", ...(shallow ? ["--depth=1"] : []), "origin",
    "+refs/heads/gh-pages:refs/check-pages/gh-pages",
    "+refs/heads/main:refs/check-pages/main",
  );
} catch (err) {
  const why = String(err.stderr || err.message).trim().split("\n")[0];
  if (process.env.CI) {
    console.error(`check-pages: could not fetch gh-pages and main from origin: ${why}`);
    process.exit(1);
  }
  console.warn(`check-pages: skipped (could not reach origin: ${why})`);
  process.exit(0);
}
// Past the fetch, a missing file is a real failure, online or not.
const published = git("show", "refs/check-pages/gh-pages:player/index.html");
const mainCopy = git("show", `refs/check-pages/main:${LOCAL}`);

if (published === local || published === mainCopy) {
  console.log("check-pages: gh-pages player/index.html is in step");
  process.exit(0);
}
console.error(
  "check-pages: gh-pages player/index.html matches neither this branch's nor main's docs/player/index.html.\n" +
    "Copy docs/player/index.html to player/index.html on the gh-pages branch, commit and push (see docs/DEVELOPING.md).",
);
process.exit(1);
