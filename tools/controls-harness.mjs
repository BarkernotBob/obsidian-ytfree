/**
 * Does the control row fit, and are its targets far enough apart?
 *
 * The row is a `1fr auto 1fr` grid whose side tracks cannot shrink below their
 * contents: too wide and it overflows the note rather than reflowing, and the
 * only way to find out used to be to open it on a phone. This renders the real
 * control bar under Obsidian's own app.css plus this plugin's stylesheet, at
 * every width that matters, and reports the overflow, the gaps between
 * adjacent targets, and whether Play is actually centred on the player.
 *
 * Same setup as `tools/phone-hub-harness.mjs`, and not part of `npm test` for
 * the same reasons. Run it when the control bar changes.
 *
 *   npx asar extract-file /Applications/Obsidian.app/Contents/Resources/obsidian.asar app.css > /tmp/ytfree-harness/app.css
 *   node tools/controls-harness.mjs
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

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

// A stand-in for whatever `setIcon` draws: the size is what the layout cares
// about, and `--icon-size` is what sets it.
const icon = `<svg class="svg-icon" style="width:var(--icon-size);height:var(--icon-size)"></svg>`;
const btn = (cls, extra = "") =>
  `<button type="button" class="ytfree-btn ${cls}">${icon}${extra}</button>`;
const badge = `<span class="ytfree-btn-badge">10</span>`;

const speed = `<select class="ytfree-speed"><option>1.75×</option></select>`;

/**
 * The phone's bar: speed and PiP left, transport centred, fullscreen and
 * collapse right. The desktop's is the same row with a timestamp and a
 * download button on the right and no collapse — the wider case, on the wider
 * screen, so both are rendered.
 */
const controls = (phone) => `
  <div class="ytfree-controls">
    <div class="ytfree-controls-group ytfree-controls-side">
      ${speed}${btn("ytfree-btn-pip")}
    </div>
    <div class="ytfree-controls-group ytfree-controls-transport">
      ${btn("ytfree-btn-play")}${btn("ytfree-btn-back", badge)}${btn("ytfree-btn-forward", badge)}
    </div>
    <div class="ytfree-controls-group ytfree-controls-side">
      ${btn("ytfree-btn-fullscreen")}
      ${phone ? btn("ytfree-btn-collapse") : btn("ytfree-btn-timestamp") + btn("ytfree-btn-download")}
    </div>
  </div>`;

const page = (phone) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${appCss}</style><style>${pluginCss}</style>
<style>html,body{margin:0}</style></head>
<body class="theme-dark ${phone ? "is-phone" : "is-desktop"} mod-macos">
  <div class="workspace-leaf-content" data-type="markdown">
    <div class="view-content">
      <div class="ytfree-docked">
        <div class="ytfree-media" style="height:60px"></div>
        ${controls(phone)}
      </div>
    </div>
  </div>
</body></html>`;

const measure = () => {
  const bar = document.querySelector(".ytfree-controls");
  const barBox = bar.getBoundingClientRect();
  const buttons = [...bar.querySelectorAll(".ytfree-btn, .ytfree-speed")].sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
  );
  const boxes = buttons.map((b) => b.getBoundingClientRect());

  // Edge-to-edge distance between neighbours, in document order across the
  // whole row — the number that decides whether a thumb can miss.
  const gaps = boxes.slice(1).map((b, i) => Math.round(b.left - boxes[i].right));

  const play = bar.querySelector(".ytfree-btn-play").getBoundingClientRect();
  const badges = [...bar.querySelectorAll(".ytfree-btn-badge")].map((b) => {
    const box = b.getBoundingClientRect();
    const parent = b.parentElement.getBoundingClientRect();
    // Positive = the numeral sits right of the button's own axis.
    return Math.round(box.left + box.width / 2 - (parent.left + parent.width / 2));
  });

  return {
    // The failure this harness exists to catch.
    overflow: Math.round(bar.scrollWidth - bar.clientWidth),
    barWidth: Math.round(barBox.width),
    smallestTarget: Math.min(...boxes.map((b) => Math.round(Math.min(b.width, b.height)))),
    gaps,
    smallestGap: Math.min(...gaps),
    // Play centred on the bar, not on whatever sits beside it.
    playOffCentre: Math.round(play.left + play.width / 2 - (barBox.left + barBox.width / 2)),
    badgeOffCentre: badges,
  };
};

const browser = await chromium.launch({ executablePath: CHROME });
for (const [label, width, phone] of [
  ["iPhone SE / mini (375)", 375, true],
  ["iPhone 14 (390)", 390, true],
  ["iPhone Plus (430)", 430, true],
  ["desktop pane (700)", 700, false],
]) {
  const tab = await browser.newPage({ viewport: { width, height: 700 } });
  await tab.setContent(page(phone));
  console.log(label, await tab.evaluate(measure));
  await tab.close();
}
await browser.close();
