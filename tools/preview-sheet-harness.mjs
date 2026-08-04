/**
 * The Preview sheet, on a phone, measured rather than reasoned about.
 *
 * 032 is four layout claims and one behaviour, and the four layout ones are the
 * kind that read as obviously true in a stylesheet and are obviously false on a
 * screen. This renders the Preview modal's real DOM — Obsidian's own app.css
 * plus this plugin's stylesheet, headless Chromium at iPhone 14 size — and
 * reports:
 *
 *   panelTop / panelBottom      is the pop-out inside the screen, or clipped?
 *   panelClippedBy              the ancestor doing the clipping, if any
 *   describeScrollsSideways     the defect, as a number
 *   sheetScrollsSideways        the same question for the sheet itself
 *   titleScrollsAway            does the title move when the sheet scrolls?
 *   actionsPinned               do the four buttons stay on screen while it does
 *   collapsedPlayerHeight       what Collapse actually buys the description
 *
 * Not part of `npm test`: it needs Playwright and a few seconds. `app.css` is
 * in the repo, so unlike the hub harness this one needs no Obsidian install.
 *
 *   node tools/preview-sheet-harness.mjs
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
const REPO = path.join(HERE, "..");
const CHROME =
  process.env.YTFREE_CHROME ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const appCss = readFileSync(path.join(REPO, "app.css"), "utf8");
const pluginCss = readFileSync(path.join(REPO, "styles.css"), "utf8");

// A real description: the unbreakable tokens are the point. A bare playlist URL
// and a run of box-drawing characters are what every second YouTube description
// opens with, and both are one token to the line breaker.
const DESCRIPTION = [
  "In this video we look at how convection currents actually work, and why the",
  "textbook picture is wrong in three separate ways.",
  "",
  "Full playlist: https://www.youtube.com/playlist?list=PLZHQObOWTQDPD3MizzM2xVFitgF8hE_ab&index=17",
  "────────────────────────────────────────────────",
  "Chapters:",
  "0:00 Intro",
  "1:24 The textbook picture",
  "#physics #engineering #convection #thermodynamics #heattransfer #fluiddynamics",
].join("\n");

const panelRow = (label) => `
  <div class="ytfree-panel-row"><span class="ytfree-panel-label">${label}</span>
    <button class="ytfree-switch"><span class="ytfree-switch-knob"></span></button></div>`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>${appCss}</style><style>${pluginCss}</style>
<style>html,body{margin:0;height:100%}</style></head>
<body class="theme-dark is-phone is-mobile mod-macos">
 <div class="app-container"><div class="horizontal-main-container"><div class="workspace"></div></div></div>
 <div class="modal-container mod-dim">
  <div class="modal-bg"></div>
  <div class="modal ytfree-preview-modal">
   <div class="modal-content">
    <div class="ytfree-preview-player">
     <div class="ytfree-wrapper ytfree-preview-wrapper">
      <div class="ytfree-media"><video class="ytfree-video"></video></div>
      <div class="ytfree-controls">
       <div class="ytfree-panel-scrim"></div>
       <div class="ytfree-panel ytfree-panel-sheet is-open" role="dialog">
        ${panelRow("Smart Speed")}${panelRow("Skip music too")}${panelRow("Pause speed")}
        ${panelRow("Shortest pause")}${panelRow("Pause while typing")}
        <div class="ytfree-panel-note">This video only</div>
        <button class="ytfree-panel-link">All YT Free settings…</button>
       </div>
       <div class="ytfree-controls-group ytfree-controls-side ytfree-controls-left">
        <select class="ytfree-speed"><option>1×</option></select>
        <button class="ytfree-btn">P</button><button class="ytfree-btn">F</button></div>
       <div class="ytfree-controls-group ytfree-controls-transport">
        <button class="ytfree-btn">-</button><button class="ytfree-btn ytfree-btn-play">▶</button>
        <button class="ytfree-btn">+</button></div>
       <div class="ytfree-controls-group ytfree-controls-side ytfree-controls-right">
        <button class="ytfree-btn ytfree-btn-collapse">^</button>
        <button class="ytfree-btn ytfree-btn-share">s</button>
        <button class="ytfree-btn ytfree-btn-panel">o</button></div>
      </div>
     </div>
    </div>
    <div class="ytfree-preview-title">How Convection Currents Actually Work — and the supercalifragilisticexpialidocious case</div>
    <div class="ytfree-preview-facts">Veritasium · 21:04 · 1.2M views · 3 days ago</div>
    <div class="ytfree-preview-description">${DESCRIPTION}</div>
    <div class="ytfree-preview-transcript">
     <button class="ytfree-preview-transcript-head"><span class="ytfree-preview-transcript-label">Transcript · 63 sections</span></button>
     <div class="ytfree-preview-transcript-body"></div>
    </div>
    <div class="ytfree-card-actions ytfree-preview-actions">
     ${["Watch", "Keep", "Remove", "Share"]
       .map((l) => `<button class="ytfree-card-act"><span class="ytfree-card-state ytfree-card-idle"><span class="ytfree-card-label">${l}</span></span></button>`)
       .join("")}
    </div>
   </div>
  </div>
 </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.setContent(html);

const measured = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const box = (sel) => q(sel).getBoundingClientRect();
  const sideways = (el) => Math.round(el.scrollWidth - el.clientWidth);

  /*
   * Which ancestor, if any, cuts the panel off — and this is the entire bug, so
   * it is worth getting right rather than approximating. An overflow ancestor
   * only clips a positioned element if it is in that element's containing-block
   * chain:
   *
   *   position: absolute  →  clipped by positioned ancestors that scroll
   *   position: fixed     →  clipped by nothing, unless an ancestor has a
   *                          transform/filter/perspective/contain, which drags
   *                          the containing block back down out of the viewport
   *
   * That difference is the fix. The popover was absolute inside .modal-content,
   * so .modal-content's scroller cut it off no matter what height it was given.
   */
  const clipperOf = (el) => {
    const fixed = getComputedStyle(el).position === "fixed";
    const rect = el.getBoundingClientRect();
    for (let up = el.parentElement; up && up !== document.documentElement; up = up.parentElement) {
      const style = getComputedStyle(up);
      const anchors =
        style.transform !== "none" ||
        style.filter !== "none" ||
        style.perspective !== "none" ||
        style.contain.includes("paint") ||
        style.contain.includes("strict") ||
        style.contain.includes("content");
      if (fixed && !anchors) continue;
      const scrolls = style.overflow !== "visible" || style.overflowY !== "visible";
      if (!scrolls) continue;
      const r = up.getBoundingClientRect();
      if (rect.top < r.top - 0.5 || rect.bottom > r.bottom + 0.5) {
        return `${up.className.split(" ")[0]} (${Math.round(r.top)}–${Math.round(r.bottom)})`;
      }
      if (fixed) break;
    }
    return null;
  };

  const panel = q(".ytfree-panel");

  /*
   * The old popover, reconstructed: absolute, capped at the distance from the
   * top of the *screen* to the top of the control bar. That cap is the code
   * that shipped, and the number it produces is fine — it is measured against
   * the wrong box, which is why the panel was still cut in half.
   */
  panel.classList.remove("ytfree-panel-sheet");
  const barTop = q(".ytfree-controls").getBoundingClientRect().top;
  panel.style.maxHeight = `${Math.round(barTop) - 12}px`;
  const oldBox = panel.getBoundingClientRect();
  const before = {
    cap: Math.round(barTop) - 12,
    top: Math.round(oldBox.top),
    bottom: Math.round(oldBox.bottom),
    clippedBy: clipperOf(panel),
  };

  panel.classList.add("ytfree-panel-sheet");
  panel.style.maxHeight = "";
  const panelBox = panel.getBoundingClientRect();
  const clippedBy = clipperOf(panel);

  const content = q(".modal-content");
  const titleBefore = box(".ytfree-preview-title").top;
  const playerBefore = box(".ytfree-preview-player").top;
  content.scrollTop = content.scrollHeight;
  const titleAfter = box(".ytfree-preview-title").top;
  const playerAfter = box(".ytfree-preview-player").top;
  const actionsBox = box(".ytfree-preview-actions");
  const contentBox = content.getBoundingClientRect();
  content.scrollTop = 0;

  const tall = box(".ytfree-preview-player").height;
  q(".ytfree-preview-wrapper").classList.add("is-collapsed");
  const short = box(".ytfree-preview-player").height;
  // The video is still 200-odd points tall and still playing — iOS stops a
  // `display: none` video — so the only thing making a collapse look like a
  // collapse is .ytfree-media clipping it. Worth asserting, not assuming.
  const sliver = box(".ytfree-video").height;
  const media = box(".ytfree-media");
  const sliverClipped = getComputedStyle(q(".ytfree-media")).overflow === "hidden" && media.height < 1;
  q(".ytfree-preview-wrapper").classList.remove("is-collapsed");

  return {
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    oldPopover: before,
    panelTop: Math.round(panelBox.top),
    panelBottom: Math.round(panelBox.bottom),
    panelHeight: Math.round(panelBox.height),
    panelOnScreen: panelBox.top >= -0.5 && panelBox.bottom <= window.innerHeight + 0.5,
    panelClippedBy: clippedBy,
    scrimCoversScreen:
      Math.round(box(".ytfree-panel-scrim").width) === window.innerWidth &&
      Math.round(box(".ytfree-panel-scrim").height) === window.innerHeight,

    describeScrollsSideways: sideways(q(".ytfree-preview-description")),
    sheetScrollsSideways: sideways(content),

    titleScrollsAway: Math.round(titleBefore - titleAfter),
    playerStaysPut: Math.round(playerBefore - playerAfter),
    actionsPinned: actionsBox.bottom <= contentBox.bottom + 0.5,

    playerHeight: Math.round(tall),
    collapsedPlayerHeight: Math.round(short),
    collapseBuys: Math.round(tall - short),
    collapsedVideoStillTall: Math.round(sliver),
    collapsedSliverClipped: sliverClipped,
  };
});

await browser.close();
console.log(measured);
