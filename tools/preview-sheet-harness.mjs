/**
 * The Preview sheet, on a phone, measured rather than reasoned about.
 *
 * 032 is four layout claims and one behaviour, and the four layout ones are the
 * kind that read as obviously true in a stylesheet and are obviously false on a
 * screen. 037 and 039 are two more of the same: where the pop-out opens, and
 * whether the transcript is on the screen at all. This renders the Preview
 * modal's real DOM — Obsidian's own app.css plus this plugin's stylesheet,
 * headless Chromium at iPhone 14 size, portrait and landscape — and reports:
 *
 *   panel*                      037: does the pop-out hang off its button and
 *                               stay on the screen, un-clipped?
 *   transcriptOnScreen          039: is the transcript visible without
 *   playerOnScreen              scrolling, and the picture at the same time?
 *   sheetScrolls                with the description shut, it should not
 *   transcriptScrollsItself     but the transcript's own region should
 *   openingDescriptionMoves*    what opening the description costs
 *   noTranscript*               the empty case, which must not leave a hole
 *   describeScrollsSideways     the 032 defect, as a number
 *   collapsedPlayerHeight       what Collapse actually buys
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
import { anchorVisible, panelPlacement } from "../src/panel.ts";

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

/** 63 paragraphs, which is a 20-minute video: long enough to be the problem. */
const cues = Array.from({ length: 63 }, (_, i) => {
  const at = `${Math.floor((i * 20) / 60)}:${String((i * 20) % 60).padStart(2, "0")}`;
  return `<button class="ytfree-preview-cue"><span class="ytfree-preview-cue-time">${at}</span><span class="ytfree-preview-cue-text">and this is the ${i}th thing that gets said, at some length, because a paragraph of transcript is two or three lines of it</span></button>`;
}).join("");

const sheet = (transcript) => `<!doctype html>
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
       <div class="ytfree-panel ytfree-panel-anchored is-open" role="dialog">
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
    <div class="ytfree-preview-describe">
     <button class="ytfree-preview-disclose" aria-expanded="false">
      <span class="ytfree-preview-disclose-chevron"></span>
      <span class="ytfree-preview-disclose-label">Description</span></button>
     <div class="ytfree-preview-description">${DESCRIPTION}</div>
    </div>
    <div class="ytfree-preview-transcript${transcript ? " is-open" : ""}">
     <button class="ytfree-preview-transcript-head"${transcript ? "" : " disabled"}><span class="ytfree-preview-transcript-chevron"></span><span class="ytfree-preview-transcript-label">${transcript ? "Transcript · 63 sections" : "Transcript — none for this video"}</span></button>
     <div class="ytfree-preview-transcript-body">${transcript ? cues : ""}</div>
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

/** Read the boxes the placement rule needs, then place the panel the way the plugin does. */
async function placePanel(page) {
  const room = await page.evaluate(() => {
    const box = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    const panel = document.querySelector(".ytfree-panel");
    panel.style.maxHeight = "";
    panel.style.width = "";
    return {
      anchor: box(".ytfree-btn-panel"),
      panel: { width: panel.getBoundingClientRect().width, height: panel.scrollHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  const visible = anchorVisible(room.anchor, room.viewport);
  const placement = panelPlacement({ anchored: true, ...room });
  await page.evaluate((p) => {
    const panel = document.querySelector(".ytfree-panel");
    panel.style.left = `${p.left}px`;
    panel.style.top = `${p.top}px`;
    panel.style.width = `${p.width}px`;
    panel.style.maxHeight = `${p.maxHeight}px`;
    panel.classList.toggle("is-below", p.side === "down");
  }, placement);
  return { placement, visible };
}

async function measure(viewport, transcript = true) {
  const page = await browser.newPage({ viewport });
  await page.setContent(sheet(transcript));
  const panel = await placePanel(page);

  const measured = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const box = (sel) => q(sel).getBoundingClientRect();
    const sideways = (el) => Math.round(el.scrollWidth - el.clientWidth);
    const scrolls = (el) => Math.round(el.scrollHeight - el.clientHeight);
    const onScreen = (r) => r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5 && r.height > 1;

    /*
     * Which ancestor, if any, cuts the panel off — and this was the whole of the
     * 032 bug, so it is worth getting right rather than approximating. An
     * overflow ancestor only clips a positioned element if it is in that
     * element's containing-block chain:
     *
     *   position: absolute  →  clipped by positioned ancestors that scroll
     *   position: fixed     →  clipped by nothing, unless an ancestor has a
     *                          transform/filter/perspective/contain, which drags
     *                          the containing block back down out of the viewport
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
        const clips = style.overflow !== "visible" || style.overflowY !== "visible";
        if (!clips) continue;
        const r = up.getBoundingClientRect();
        if (rect.top < r.top - 0.5 || rect.bottom > r.bottom + 0.5) {
          return `${up.className.split(" ")[0]} (${Math.round(r.top)}–${Math.round(r.bottom)})`;
        }
        if (fixed) break;
      }
      return null;
    };

    const content = q(".modal-content");
    const panelEl = q(".ytfree-panel");
    const panelBox = panelEl.getBoundingClientRect();
    const anchorBox = box(".ytfree-btn-panel");
    const body = q(".ytfree-preview-transcript-body");
    const open = q(".ytfree-preview-transcript").classList.contains("is-open");

    // 039, shut: the whole sheet fits and both halves are on the screen.
    const shut = {
      transcriptOnScreen: open && onScreen(body.getBoundingClientRect()),
      transcriptRegionHeight: Math.round(body.getBoundingClientRect().height),
      transcriptScrollsItself: open ? scrolls(body) : 0,
      transcriptOverscroll: getComputedStyle(body).overscrollBehaviorY,
      playerOnScreen: onScreen(box(".ytfree-preview-player")),
      actionsOnScreen: onScreen(box(".ytfree-preview-actions")),
      sheetScrolls: scrolls(content),
      describeScrollsSideways: sideways(q(".ytfree-preview-description")),
      sheetScrollsSideways: sideways(content),
    };

    // Autoscroll inside the region moves nothing else on the sheet.
    const playerBeforeFollow = box(".ytfree-preview-player").top;
    if (open) body.scrollTop = body.scrollHeight;
    const followMovesSheet = Math.round(playerBeforeFollow - box(".ytfree-preview-player").top);
    if (open) body.scrollTop = 0;

    /*
     * And what opening the description costs. `titleShut`/`titleOpen` are not
     * padding: an over-constrained grid is allowed to size a row from its
     * item's *minimum*, and an item with `overflow: hidden` has a minimum of
     * zero — the title vanished the first time landscape's description opened,
     * and the two numbers are what caught it.
     */
    const before = {
      title: Math.round(box(".ytfree-preview-title").height),
      rows: getComputedStyle(content).gridTemplateRows,
      playerTop: box(".ytfree-preview-player").top,
    };
    q(".ytfree-preview-describe").classList.add("is-open");
    q(".ytfree-preview-disclose").setAttribute("aria-expanded", "true");
    const opened = {
      openingDescriptionMovesPlayer: Math.round(before.playerTop - box(".ytfree-preview-player").top),
      openingDescriptionSheetScrolls: scrolls(content),
      transcriptKept: Math.round(body.getBoundingClientRect().height),
      descriptionHeight: Math.round(box(".ytfree-preview-description").height),
      titleShut: before.title,
      titleOpen: Math.round(box(".ytfree-preview-title").height),
      rowsShut: before.rows,
      rowsOpen: getComputedStyle(content).gridTemplateRows,
      sheetHeight: Math.round(content.getBoundingClientRect().height),
    };
    q(".ytfree-preview-describe").classList.remove("is-open");

    const tall = box(".ytfree-preview-player").height;
    q(".ytfree-preview-wrapper").classList.add("is-collapsed");
    const short = box(".ytfree-preview-player").height;
    q(".ytfree-preview-wrapper").classList.remove("is-collapsed");

    return {
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      panel: {
        top: Math.round(panelBox.top),
        bottom: Math.round(panelBox.bottom),
        left: Math.round(panelBox.left),
        right: Math.round(panelBox.right),
        hangsOffTheButton: Math.abs(panelBox.bottom - anchorBox.top) < 24 || Math.abs(panelBox.top - anchorBox.bottom) < 24,
        onScreen: panelBox.top >= -0.5 && panelBox.bottom <= window.innerHeight + 0.5,
        clippedBy: clipperOf(panelEl),
        scrimIsInvisible: getComputedStyle(q(".ytfree-panel-scrim")).backgroundColor === "rgba(0, 0, 0, 0)",
      },
      ...shut,
      followMovesSheet,
      ...opened,
      playerHeight: Math.round(tall),
      collapsedPlayerHeight: Math.round(short),
    };
  });

  await page.close();
  return { ...measured, placedSide: panel.placement.side, anchorVisible: panel.visible };
}

console.log("portrait, with a transcript:", await measure({ width: 390, height: 844 }));
console.log("landscape, with a transcript:", await measure({ width: 844, height: 390 }));
console.log("portrait, no transcript:", await measure({ width: 390, height: 844 }, false));

await browser.close();
