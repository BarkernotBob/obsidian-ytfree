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

// Smart Speed's time-saved readout is in the pop-out now, in the label column
// of its row. Rendered at its widest — a full hour saved — because the question
// is the same one it answered on the bar: can this text push anything wider
// than it was built?
const saved = `<span class="ytfree-panel-value">−1:04:37</span>`;

// The per-video pop-out, at its tallest: six rows, the footnote and the way out
// to the settings screen. Measured open as well as shut, because the promise it
// makes is that opening it changes the bar's geometry not at all.
const panelRow = (label, control) =>
  `<div class="ytfree-panel-row"><span class="ytfree-panel-label">${label}</span>${control}</div>`;
const panelSwitch = `<button type="button" class="ytfree-switch is-on"><span class="ytfree-switch-knob"></span></button>`;
const panelSelect = `<select class="ytfree-panel-select"><option>2.5×</option></select>`;
const panel = `
  <div class="ytfree-panel">
    ${panelRow(`Smart Speed${saved}`, panelSwitch)}
    ${panelRow("Skip music too", panelSwitch)}
    ${panelRow("Pause speed", panelSelect)}
    ${panelRow("Shortest pause", panelSelect)}
    ${panelRow("Pause while typing", panelSwitch)}
    ${panelRow("Player size", `<input type="range" class="ytfree-panel-range">`)}
    <div class="ytfree-panel-note">This video only</div>
    <button type="button" class="ytfree-panel-link">All YT Free settings…</button>
  </div>`;

/**
 * The phone's bar: speed, PiP and Fullscreen left — how it plays and where —
 * transport centred, and what it does to the note on the right: collapse, the
 * pin, and the pop-out last. The desktop's is the same row with a timestamp and
 * a download button in place of collapse: the wider case, on the wider screen,
 * so both are rendered.
 */
const controls = (phone) => `
  <div class="ytfree-controls">
    <div class="ytfree-controls-group ytfree-controls-side ytfree-controls-left">
      ${speed}${btn("ytfree-btn-pip")}${btn("ytfree-btn-fullscreen")}
    </div>
    <div class="ytfree-controls-group ytfree-controls-transport">
      ${btn("ytfree-btn-play")}${btn("ytfree-btn-back", badge)}${btn("ytfree-btn-forward", badge)}
    </div>
    <div class="ytfree-controls-group ytfree-controls-side ytfree-controls-right">
      ${phone ? btn("ytfree-btn-collapse") : btn("ytfree-btn-timestamp") + btn("ytfree-btn-download")}
      ${btn("ytfree-btn-pin")}${btn("ytfree-btn-panel")}
    </div>
    ${panel}
  </div>`;

/*
 * The purple line, in the box the platform actually gives it.
 *
 * A phone puts the video inside `.ytfree-media`; a desktop has no such box, so
 * the player builds a bare `.ytfree-stage` around the video and the line hangs
 * off that. The desktop was handed the whole wrapper as its media host instead,
 * which put the line under the section links where nobody could see it — hence
 * measuring the line against the picture here, on both shapes.
 */
const progress = `<div class="ytfree-progress is-live"><div class="ytfree-progress-fill"></div></div>`;

const stage = (phone) =>
  phone
    ? `<div class="ytfree-media" style="height:120px">${progress}</div>`
    : `<div class="ytfree-stage"><div class="ytfree-video" style="height:120px"></div>${progress}</div>`;

const page = (phone) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${appCss}</style><style>${pluginCss}</style>
<style>html,body{margin:0}</style></head>
<body class="theme-dark ${phone ? "is-phone" : "is-desktop"} mod-macos">
  <div class="workspace-leaf-content" data-type="markdown">
    <div class="view-content">
      <div class="ytfree-wrapper ${phone ? "ytfree-pinned ytfree-docked" : "ytfree-pinned"}">
        ${stage(phone)}
        ${controls(phone)}
        <div class="ytfree-sections"><button class="ytfree-section-link">Notes</button></div>
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

  // The pop-out, open: it must change nothing about the row it hangs off, and
  // it must stay inside the player rather than off the side of the screen.
  const panelEl = bar.querySelector(".ytfree-panel");
  const closedHeight = Math.round(barBox.height);
  panelEl.classList.add("is-open");
  const openBox = bar.getBoundingClientRect();
  const panelBox = panelEl.getBoundingClientRect();
  // What the panel wants, against the room there is between the bar and the top
  // of the screen. `togglePanel` caps the height at the second number, so a
  // panel taller than its room scrolls instead of running off the top.
  const panelNaturalHeight = Math.round(panelEl.scrollHeight);
  const roomAboveBar = Math.round(barBox.top);
  panelEl.classList.remove("is-open");
  const view = document.documentElement.getBoundingClientRect();

  // The two side groups, which should look like a pair rather than like one
  // group and a leftover.
  const side = [...bar.querySelectorAll(".ytfree-controls-side")].map((g) => {
    const kids = [...g.children].map((k) => k.getBoundingClientRect());
    return Math.round(kids[kids.length - 1].right - kids[0].left);
  });

  // Every control on its row's centre line. Play is taller than the rest, so
  // this is the number that says whether they are centred on each other or
  // merely sitting on the same baseline.
  const offCentreVertical = Math.max(
    ...rows.map((row) => {
      const top = Math.min(...row.boxes.map((b) => b.top));
      const bottom = Math.max(...row.boxes.map((b) => b.bottom));
      const centre = (top + bottom) / 2;
      return Math.max(...row.boxes.map((b) => Math.round(Math.abs(mid(b) - centre))));
    }),
  );

  return {
    // The failure this harness exists to catch.
    overflow: Math.round(bar.scrollWidth - bar.clientWidth),
    // Zero, or opening the pop-out moves the note.
    barGrowthWhenPanelOpens: Math.round(openBox.height) - closedHeight,
    panelOutsideView: Math.round(
      Math.max(0, view.left - panelBox.left) + Math.max(0, panelBox.right - view.right),
    ),
    barWidth: Math.round(barBox.width),
    smallestTarget: Math.min(...boxes.map((b) => Math.round(Math.min(b.width, b.height)))),
    controlRows: rows.length,
    gaps,
    smallestGap: Math.min(...gaps.flat()),
    // Play centred on the bar, not on whatever sits beside it.
    playOffCentre: Math.round(play.left + play.width / 2 - (barBox.left + barBox.width / 2)),
    badgeOffCentre: badges,
    offCentreVertical,
    sideWidths: side,
    // Both zero, or the line is not sitting on the bottom edge of the picture.
    progressBelowPicture: (() => {
      const line = document.querySelector(".ytfree-progress");
      const picture = document.querySelector(".ytfree-video, .ytfree-media");
      const a = line.getBoundingClientRect();
      const b = picture.getBoundingClientRect();
      return [Math.round(a.bottom - b.bottom), Math.round(a.width - b.width)];
    })(),
    panelNaturalHeight,
    roomAboveBar,
  };
};

/**
 * The immersive view — the plugin's own fullscreen, which is what a phone
 * turned sideways gets, because iOS refuses a real one without a gesture.
 *
 * The picture should reach both side edges of the screen, the control bar
 * should still be on it, and nothing should be off the bottom.
 */
const measureImmersive = () => {
  document.querySelector(".ytfree-wrapper").classList.add("is-immersive");
  const view = { width: window.innerWidth, height: window.innerHeight };
  const wrapper = document.querySelector(".ytfree-wrapper").getBoundingClientRect();
  const picture = document
    .querySelector(".ytfree-stage, .ytfree-media")
    .getBoundingClientRect();
  const bar = document.querySelector(".ytfree-controls").getBoundingClientRect();
  const line = document.querySelector(".ytfree-progress").getBoundingClientRect();
  return {
    coversScreen: [
      Math.round(wrapper.width - view.width),
      Math.round(wrapper.height - view.height),
    ],
    pictureWidth: Math.round(picture.width),
    // Positive = the bar has run off the bottom of the screen.
    barBelowScreen: Math.round(bar.bottom - view.height),
    barOnPicture: bar.top < picture.bottom,
    progressBelowPicture: Math.round(line.bottom - picture.bottom),
    sectionsHidden: getComputedStyle(document.querySelector(".ytfree-sections")).display === "none",
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

// And the same phone on its side, in the immersive view.
for (const [label, width, height] of [
  ["iPhone 14 landscape, immersive (844×390)", 844, 390],
  ["iPhone SE landscape, immersive (667×375)", 667, 375],
]) {
  const tab = await browser.newPage({ viewport: { width, height } });
  await tab.setContent(page(true));
  console.log(label, await tab.evaluate(measureImmersive));
  await tab.close();
}
await browser.close();
