/**
 * How many hub cards actually fit on a phone screen.
 *
 * Measuring this by eye is how "about 7" became the answer to a question the
 * card layout is supposed to settle. This renders the phone hub's real DOM,
 * under Obsidian's own app.css plus this plugin's stylesheet, in a headless
 * Chromium sized to an iPhone 14 (390×844), and reports the card height and how
 * many are fully visible in the list.
 *
 * Not part of `npm test`: it needs Obsidian installed, a Playwright browser and
 * a few seconds. Run it when the card layout changes.
 *
 *   npx asar extract-file /Applications/Obsidian.app/Contents/Resources/obsidian.asar app.css > /tmp/ytfree-harness/app.css
 *   node tools/phone-hub-harness.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

// playwright-core is not a dependency of this plugin and should not become one
// — it is installed globally, and ESM does not read NODE_PATH, so the global
// root is asked for by name.
// `.default` because playwright-core's ESM entry is a CJS wrapper: the named
// exports are its internals, and the API object is the default one.
const { chromium } = (await import(
  process.env.YTFREE_PLAYWRIGHT ??
    pathToFileURL(
      path.join(
        execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
        "playwright-core",
        "index.js",
      ),
    ).href
)).default;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_CSS = process.env.YTFREE_APP_CSS ?? "/tmp/ytfree-harness/app.css";
const CHROME =
  process.env.YTFREE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const appCss = readFileSync(APP_CSS, "utf8");
const pluginCss = readFileSync(path.join(HERE, "..", "styles.css"), "utf8");

// The longest channel name and the longest age in the vault's real data — the
// byline is measured against its worst case, not its typical one.
const CHANNELS = ["SmarterEveryDay", "Technology Connections Extra", "Practical Engineering"];
const AGES = ["21 hours ago", "3 weeks ago", "11 months ago"];

const row = (i) => `
    <div class="ytfree-hub-row">
      <div class="ytfree-hub-thumb">
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="">
        <span class="ytfree-hub-duration">1:02:03</span>
        <div class="ytfree-hub-marker"></div>
      </div>
      <div class="ytfree-hub-meta">
        <div class="ytfree-hub-title">A reasonably long video title that runs onto a second line, number ${i}</div>
      </div>
      <div class="ytfree-hub-sub">
        <span class="ytfree-hub-sub-name">${CHANNELS[i % CHANNELS.length]}</span>
        <span class="ytfree-hub-sub-age">· ${AGES[i % AGES.length]}</span>
      </div>
    </div>`;

const card = (i) => `
  <div class="ytfree-hub-card">${row(i)}
    <div class="ytfree-hub-dismiss"><button class="ytfree-hub-icon-button">×</button></div>
  </div>`;

// A search result: same row, no dismiss column.
const result = (i) => `<div class="ytfree-hub-card ytfree-hub-result">${row(i)}</div>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>${appCss}</style><style>${pluginCss}</style>
<style>html,body{margin:0;height:100%}</style></head>
<body class="theme-dark is-phone mod-macos">
  <div class="workspace-leaf-content" data-type="ytfree-hub" style="height:844px;display:flex;flex-direction:column">
    <div class="view-content">
      <div class="ytfree-hub ytfree-phone" style="height:100%">
        <div class="ytfree-hub-header">
          <div class="ytfree-hub-select"><span class="ytfree-hub-select-label">New</span></div>
          <div class="ytfree-hub-actions"><button class="ytfree-hub-icon-button">y</button><button class="ytfree-hub-icon-button">r</button></div>
        </div>
        <div class="ytfree-hub-search"><input class="ytfree-hub-search-input" type="search"></div>
        <div class="ytfree-hub-status">264 videos</div>
        <div class="ytfree-hub-body">
          <div class="ytfree-hub-list">${Array.from({ length: 12 }, (_, i) => card(i + 1)).join("")}
            <div class="ytfree-hub-results">${Array.from({ length: 3 }, (_, i) => result(i)).join("")}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.setContent(html);

const measured = await page.evaluate(() => {
  const clipped = (el) => el.scrollWidth > el.clientWidth + 1;
  const list = document.querySelector(".ytfree-hub-list");
  const cards = [...document.querySelectorAll(".ytfree-hub-card:not(.ytfree-hub-result)")];
  const results = [...document.querySelectorAll(".ytfree-hub-result")];
  const listBox = list.getBoundingClientRect();
  const boxes = cards.map((c) => c.getBoundingClientRect());
  const first = boxes[0];
  const title = cards[0].querySelector(".ytfree-hub-title");
  const titleBox = title.getBoundingClientRect();
  const dismiss = cards[0].querySelector(".ytfree-hub-dismiss").getBoundingClientRect();
  return {
    listHeight: Math.round(listBox.height),
    cardHeight: Math.round(first.height),
    // Fully visible: the whole card is inside the list's box.
    fullyVisible: boxes.filter((b) => b.bottom <= listBox.bottom + 0.5).length,
    partlyVisible: boxes.filter((b) => b.top < listBox.bottom - 0.5).length,
    // Every card the same height is the no-reflow requirement, measured.
    heights: [...new Set(boxes.map((b) => Math.round(b.height)))],
    // The width the dismiss column took is width the title did not get, so it
    // is measured rather than assumed: how wide the title runs, and how many
    // characters of it survive two lines at this font.
    titleWidth: Math.round(titleBox.width),
    titleLines: Math.round(titleBox.height / parseFloat(getComputedStyle(title).lineHeight)),
    titleClipped: title.scrollHeight > titleBox.height + 1,
    dismissWidth: Math.round(dismiss.width),
    dismissFullHeight: Math.abs(dismiss.height - first.height) < 1.5,
    overflows: cards.some((c) => c.scrollWidth > c.clientWidth + 1),

    // The point of the whole change: the byline runs the width of the card
    // rather than the width of the title column, and the age is never the part
    // that gets cut. Both are asked of every card, worst-case names included.
    bylineWidth: Math.round(cards[0].querySelector(".ytfree-hub-sub").getBoundingClientRect().width),
    agesClipped: cards.filter((c) => clipped(c.querySelector(".ytfree-hub-sub-age"))).length,
    channelsClipped: cards.filter((c) => clipped(c.querySelector(".ytfree-hub-sub-name"))).length,
    durationsClipped: cards.filter((c) => clipped(c.querySelector(".ytfree-hub-duration"))).length,

    // A result card has no dismiss column, so its content is wider — and it
    // must still be exactly as tall as a hub card.
    resultHeights: [...new Set(results.map((r) => Math.round(r.getBoundingClientRect().height)))],
    resultBylineWidth: Math.round(
      results[0].querySelector(".ytfree-hub-sub").getBoundingClientRect().width,
    ),
    resultAgesClipped: results.filter((r) => clipped(r.querySelector(".ytfree-hub-sub-age"))).length,

    // Scroll room past the last card, so Obsidian's floating toolbar cannot sit
    // on top of it at the end of the list.
    tailRoom: Math.round(
      list.scrollHeight -
        ([...cards, ...results].at(-1).getBoundingClientRect().bottom -
          listBox.top +
          list.scrollTop),
    ),
  };
});

await browser.close();
console.log(measured);
