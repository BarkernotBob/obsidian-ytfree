/**
 * Does the control row fit, and are its targets far enough apart?
 *
 * The bar is a `1fr auto 1fr` grid whose side tracks cannot shrink below their
 * contents: too wide and it overflows the note rather than reflowing, and the
 * only way to find out used to be to open it on a phone. This renders the real
 * control bar under Obsidian's own app.css plus this plugin's stylesheet, at
 * every width that matters, and reports the overflow, the gaps between
 * adjacent targets, and whether Play is actually centred on the player.
 *
 * Below 460pt the bar is deliberately two rows (transport above, side controls
 * below), so `controlRows` is 2 on the phone widths and 1 on the desktop, and
 * the gaps are reported per row.
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

// Smart Speed's time-saved readout lives inside its button, in the same badge
// strip the skip buttons use. Rendered at its widest — a full hour saved — so
// the measurement answers the question that matters: can this text ever push
// the row wider than it was built?
const saved = `<span class="ytfree-btn-badge ytfree-smart-saved">−1:04:37</span>`;

/**
 * The phone's bar: speed, Smart Speed and PiP left, transport centred,
 * fullscreen and collapse right. The desktop's is the same row with a timestamp
 * and a download button on the right and no collapse — the wider case, on the
 * wider screen, so both are rendered.
 */
const controls = (phone) => `
  <div class="ytfree-controls">
    <div class="ytfree-controls-group ytfree-controls-side">
      ${speed}${btn("ytfree-btn-smart", saved)}${btn("ytfree-btn-pip")}
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
  const buttons = [...bar.querySelectorAll(".ytfree-btn, .ytfree-speed")];
  const boxes = buttons.map((b) => b.getBoundingClientRect());

  // Grouped by row before the gaps are taken. The bar is one row on a desktop
  // and two on a narrow phone, and measuring across a row break would report
  // the distance between a control and something 40px below it as a gap.
  // Grouped on the centre line, not the top edge: Play is 8px taller than
  // everything beside it and shares no top edge with any of it.
  const mid = (b) => b.top + b.height / 2;
  const rows = [];
  for (const box of [...boxes].sort((a, b) => mid(a) - mid(b))) {
    const row = rows.find((r) => Math.abs(r.mid - mid(box)) < 12);
    if (row) row.boxes.push(box);
    else rows.push({ mid: mid(box), boxes: [box] });
  }
  for (const row of rows) row.boxes.sort((a, b) => a.left - b.left);

  // Edge-to-edge distance between neighbours within a row — the number that
  // decides whether a thumb can miss. The wide ones are the deliberate air
  // between groups; the small ones are what this harness is watching.
  const gaps = rows.map((row) =>
    row.boxes.slice(1).map((b, i) => Math.round(b.left - row.boxes[i].right)),
  );

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
    controlRows: rows.length,
    gaps,
    smallestGap: Math.min(...gaps.flat()),
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
