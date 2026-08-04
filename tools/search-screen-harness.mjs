/**
 * Does the search screen hold still, and does it fit on a phone?
 *
 * The rule this plugin is held to is that a click must never move anything, and
 * the search screen is where it is hardest to keep: four dropdowns that change
 * their own text, a filter that gains a "set" mark, a status line that rewrites
 * itself, and a block of empty-state copy that swaps between five different
 * lengths. Reasoning about that from the stylesheet is how you convince
 * yourself; measuring it is how you find out.
 *
 * This renders the browse screen's real DOM under Obsidian's own app.css plus
 * this plugin's stylesheet, in a headless Chromium sized to an iPhone 14
 * (390×844) and to a desktop pane, and reports:
 *
 *   - anything that moved when a filter was set, or when the state block
 *     changed from one message to another;
 *   - anything scrolling sideways;
 *   - any control under 40pt on the phone.
 *
 * What it deliberately does not measure: the inside of a card. The card is
 * issue 023's two-up phone layout, shared with the rest of the hub, and
 * `tools/phone-hub-harness.mjs` already measures it. The cards here are
 * stand-ins of the right height, present so the headings, the separators and
 * the More button below them are measured in place.
 *
 * Not part of `npm test`: it needs Obsidian's app.css and a Playwright browser.
 * Run it when the search screen's layout changes.
 *
 *   node tools/search-screen-harness.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const { chromium } = (
  await import(
    process.env.YTFREE_PLAYWRIGHT ??
      pathToFileURL(
        path.join(
          execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
          "playwright-core",
          "index.js",
        ),
      ).href
  )
).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const APP_CSS = process.env.YTFREE_APP_CSS ?? path.join(ROOT, "app.css");
const CHROME =
  process.env.YTFREE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const appCss = readFileSync(APP_CSS, "utf8");
const pluginCss = readFileSync(path.join(ROOT, "styles.css"), "utf8");

// The two icons the screen ships itself. Inlined as the <svg> Obsidian's
// `setIcon` would leave behind, so the boxes around them measure honestly.
const icon = (paths) =>
  `<svg class="svg-icon" viewBox="0 0 100 100">` +
  `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;

const SEARCH_YT = icon(
  '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>' +
    '<path d="m9.2 7.8 5.6 3.2-5.6 3.2z" fill="currentColor" stroke-width="1.2"/>',
);
const PLAIN = icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>');

const FILTERS = [
  ["Uploaded", ["Any time", "Last hour", "Today", "This week", "This month", "This year"]],
  ["Length", ["Any length", "Under 4 minutes", "4–20 minutes", "Over 20 minutes"]],
  ["Type", ["Any type", "Live", "4K", "HD", "Subtitles", "Creative Commons"]],
  ["Sort by", ["Relevance", "Upload date", "View count", "Rating"]],
];

const filterField = ([label, options]) => `
  <div class="ytfree-hub-filterbar-field">
    <div class="ytfree-hub-filterbar-label">${label}</div>
    <select class="dropdown ytfree-hub-filterbar-select">
      ${options.map((o) => `<option>${o}</option>`).join("")}
    </select>
  </div>`;

// A stand-in for a card: the wrapper classes the search screen styles, and a
// fixed-height inside standing in for the parts it does not own.
const card = (i) => `
  <div class="ytfree-hub-card ytfree-hub-result">
    <div class="ytfree-harness-card-body">Result ${i}</div>
  </div>`;

const state = (kind, headline, help, retry) => `
  <div class="ytfree-hub-state is-${kind}">
    <div class="ytfree-hub-state-icon">${SEARCH_YT}</div>
    <div class="ytfree-hub-state-headline">${headline}</div>
    <div class="ytfree-hub-state-help">${help}</div>
    <button class="ytfree-hub-state-retry${retry ? "" : " is-hidden"}">Try again</button>
  </div>`;

const page = (phone) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${appCss}</style><style>${pluginCss}</style>
<style>
  body { margin: 0 }
  /* What a workspace leaf gives the view: a fixed box to fill, so a taller or
     shorter list scrolls instead of resizing the view. */
  .harness { height: 100vh; display: flex; flex-direction: column }
  .harness > .ytfree-hub { flex: 1; min-height: 0 }
  .ytfree-harness-card-body { height: 210px }
</style>
</head><body class="theme-dark${phone ? " is-phone is-mobile" : ""}">
<div class="workspace-leaf-content" data-type="ytfree-hub">
  <div class="view-content harness">
    <div class="ytfree-hub${phone ? " ytfree-phone" : ""}" id="hub">
      <div class="ytfree-hub-header ytfree-hub-header-browse">
        <button class="ytfree-hub-icon-button ytfree-hub-back">${PLAIN}</button>
        <div class="ytfree-hub-screen-title">
          <span class="ytfree-hub-screen-icon">${SEARCH_YT}</span>
          <span class="ytfree-hub-screen-name">Search YouTube</span>
        </div>
      </div>
      <div class="ytfree-hub-searchbar">
        <div class="ytfree-search-field">
          <span class="ytfree-search-field-icon">${PLAIN}</span>
          <input class="ytfree-search-field-input" type="search" placeholder="Search all of YouTube">
          <button class="ytfree-search-field-go">${PLAIN}</button>
        </div>
      </div>
      <div class="ytfree-hub-filterbar">${FILTERS.map(filterField).join("")}</div>
      <div class="ytfree-hub-status ytfree-hub-status-browse" id="status">Type a search and press Enter</div>
      <div class="ytfree-hub-body">
        <div class="ytfree-hub-list" id="list">
          ${state("idle", "Search all of YouTube", "No ads, no recommendations, and nothing here plays. Pick a result and it lands in your hub.", false)}
        </div>
      </div>
    </div>
  </div>
</div>
</body></html>`;

const RESULTS = (n) =>
  `<div class="ytfree-hub-results ytfree-hub-grid">` +
  `<div class="ytfree-hub-results-heading">Results</div>` +
  Array.from({ length: n }, (_, i) => card(i)).join("") +
  `</div><div class="ytfree-hub-results ytfree-hub-grid"></div>` +
  `<button class="ytfree-hub-more">More results</button>`;

/** Every element's box, keyed by a stable path through the tree. */
const SNAPSHOT = `(() => {
  const out = {};
  const walk = (el, key) => {
    const r = el.getBoundingClientRect();
    out[key] = [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10,
                Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
    [...el.children].forEach((c, i) => walk(c, key + "/" + i + ":" + c.className));
  };
  walk(document.getElementById("hub"), "hub");
  return out;
})()`;

function diff(before, after, ignore = () => false) {
  const moved = [];
  for (const key of Object.keys(before)) {
    if (!(key in after) || ignore(key)) continue;
    if (before[key].join() !== after[key].join()) {
      moved.push(`${key}\n      was ${before[key].join(", ")}\n      now ${after[key].join(", ")}`);
    }
  }
  return moved;
}

const problems = [];
const note = (what) => problems.push(what);

const browser = await chromium.launch({ executablePath: CHROME });

for (const phone of [true, false]) {
  const label = phone ? "phone 390×844" : "desktop 900×700";
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 900, height: 700 },
    deviceScaleFactor: 2,
  });
  const p = await ctx.newPage();
  await p.setContent(page(phone), { waitUntil: "load" });

  console.log(`\n── ${label} ──`);

  // 1. Nothing scrolls sideways, in either state.
  for (const body of ["idle", "results"]) {
    if (body === "results") {
      await p.evaluate((html) => (document.getElementById("list").innerHTML = html), RESULTS(6));
    }
    const over = await p.evaluate(() =>
      [...document.querySelectorAll("#hub *")]
        .filter((el) => !el.closest(".ytfree-hub-card")) // issue 023's, measured elsewhere
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        .map((el) => `${el.className} (${el.scrollWidth} > ${el.clientWidth})`),
    );
    console.log(`  sideways overflow, ${body}: ${over.length === 0 ? "none" : over.join("; ")}`);
    if (over.length) note(`${label}: sideways overflow in ${body} — ${over.join("; ")}`);
  }

  // 2. Setting a filter moves nothing. Both halves of it: the select's own text
  //    changes, and it gains the `is-set` mark.
  await p.evaluate((html) => (document.getElementById("list").innerHTML = html), RESULTS(6));
  const beforeFilter = await p.evaluate(SNAPSHOT);
  await p.evaluate(() => {
    const sel = document.querySelectorAll(".ytfree-hub-filterbar-select");
    sel[2].selectedIndex = 5; // "Creative Commons" — the longest label there is
    sel[2].classList.add("is-set");
    sel[0].selectedIndex = 3;
    sel[0].classList.add("is-set");
  });
  const afterFilter = await p.evaluate(SNAPSHOT);
  const filterMoved = diff(beforeFilter, afterFilter);
  console.log(`  filter set → moved: ${filterMoved.length === 0 ? "nothing" : filterMoved.length}`);
  for (const m of filterMoved) console.log(`    ${m}`);
  if (filterMoved.length) note(`${label}: setting a filter moved ${filterMoved.length} boxes`);

  // 3. The chrome above the list holds still while the state block changes
  //    between its five messages — including the one that grows a Try again.
  const blocks = [
    state("idle", "Search all of YouTube", "No ads, no recommendations, and nothing here plays. Pick a result and it lands in your hub.", false),
    state("loading", "Searching YouTube…", "", false),
    state("error", "Search failed", "net::ERR_INTERNET_DISCONNECTED", true),
    state("none", "Nothing found for “qwzxvplk 8817”", "Try fewer words, or a different spelling.", false),
    state("allInHub", "You already have all of these", "Every result for “veritasium” is already in your hub — saved, kept, or hidden.", false),
  ];
  await p.evaluate((html) => (document.getElementById("list").innerHTML = html), blocks[0]);
  const beforeState = await p.evaluate(SNAPSHOT);
  // Only the chrome is compared: the block itself is the thing being replaced.
  const chromeOnly = (key) => key.includes("ytfree-hub-list") || key.includes("hub-state");
  let stateMoved = [];
  for (const html of blocks.slice(1)) {
    await p.evaluate((h) => (document.getElementById("list").innerHTML = h), html);
    stateMoved = stateMoved.concat(diff(beforeState, await p.evaluate(SNAPSHOT), chromeOnly));
  }
  console.log(`  state swaps → chrome moved: ${stateMoved.length === 0 ? "nothing" : stateMoved.length}`);
  for (const m of stateMoved) console.log(`    ${m}`);
  if (stateMoved.length) note(`${label}: a state swap moved ${stateMoved.length} boxes of chrome`);

  // 4. Touch targets, on the phone only.
  if (phone) {
    const small = await p.evaluate(() =>
      [...document.querySelectorAll("#hub button, #hub select, #hub input")]
        .map((el) => ({ what: el.className, h: Math.round(el.getBoundingClientRect().height) }))
        .filter((x) => x.h > 0 && x.h < 40),
    );
    console.log(`  controls under 40pt: ${small.length === 0 ? "none" : JSON.stringify(small)}`);
    if (small.length) note(`${label}: ${small.length} controls under 40pt — ${JSON.stringify(small)}`);

    const fieldFont = await p.evaluate(
      () => getComputedStyle(document.querySelector(".ytfree-search-field-input")).fontSize,
    );
    console.log(`  search field font: ${fieldFont} (16px or iOS zooms)`);
    if (parseFloat(fieldFont) < 16) note(`${label}: search field is ${fieldFont}, iOS will zoom`);
  }

  await ctx.close();
}

await browser.close();

console.log("");
if (problems.length === 0) console.log("✔ nothing moved, nothing overflowed, nothing too small.");
else {
  console.log("✘ problems:");
  for (const p of problems) console.log(`  - ${p}`);
  process.exitCode = 1;
}
