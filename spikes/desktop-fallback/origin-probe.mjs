/*
 * Cheap proxy for the one question that decides the desktop fallback:
 * does a YouTube /embed iframe refuse to configure itself when the host page
 * is not on an http(s) origin?
 *
 * Mobile already answered yes — error 153 on all eight variants, because
 * Obsidian iOS runs at `capacitor://localhost` (issue 004). Obsidian *desktop*
 * runs at `app://obsidian.md`, which is a custom scheme too, so the same
 * refusal is the thing to expect rather than hope against.
 *
 * This cannot open `app://obsidian.md` — only Obsidian can. It brackets it:
 *   control  http://localhost   a real http origin, must PLAY, or the probe lies
 *   subject  file://            no origin, no Referer — the closest thing a
 *                               plain Chromium can be to a custom scheme
 *
 * A file:// failure is not proof about app://. It is a strong prior, obtained
 * in a minute, that tells you whether the in-Obsidian spike is worth installing
 * to confirm or worth skipping straight past to the <webview> route.
 *
 * Usage: node origin-probe.mjs [videoId]
 */
import { chromium } from "/Users/me/.local/node-v24.18.0-darwin-arm64/lib/node_modules/playwright-core/index.mjs";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const VIDEO = process.argv[2] || "h0EGCnBjTVk";
const WAIT_MS = 25_000;

/** The harness page. Same handshake the mobile spike used, results in a global. */
const page = (videoId) => `<!doctype html>
<meta charset="utf-8">
<body style="margin:0;background:#111">
<div id="box" style="position:relative;width:640px;aspect-ratio:16/9"></div>
<script>
window.__log = [];
window.__state = { firstMessageMs: null, ready: false, errors: [], times: [], states: [] };
const started = Date.now();
const log = (m) => window.__log.push(((Date.now()-started)/1000).toFixed(1) + "s " + m);
log("page origin: " + window.location.origin);

const frame = document.createElement("iframe");
frame.src = "https://www.youtube.com/embed/${videoId}?playsinline=1&rel=0&enablejsapi=1&widgetid=1";
frame.allow = "autoplay; encrypted-media";
frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
frame.addEventListener("load", () => log("iframe load event"));
document.getElementById("box").appendChild(frame);

window.addEventListener("message", (evt) => {
  if (evt.source !== frame.contentWindow) return;
  if (window.__state.firstMessageMs === null) {
    window.__state.firstMessageMs = Date.now() - started;
    log("channel open from " + evt.origin);
  }
  let data = evt.data;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch { return; } }
  if (!data || typeof data !== "object") return;

  const code = data.info && data.info.errorCode;
  if (data.event === "onError" || code) {
    const c = String(code ?? JSON.stringify(data.info || data).slice(0, 80));
    if (!window.__state.errors.includes(c)) { window.__state.errors.push(c); log("PLAYER ERROR " + c); }
  }
  if ((data.event === "onReady" || data.event === "initialDelivery") && !window.__state.ready) {
    window.__state.ready = true;
    log("frame reports " + data.event);
    // Only a frame that configured itself will act on this.
    frame.contentWindow.postMessage(JSON.stringify(
      { event: "command", func: "playVideo", args: [], id: 1, channel: "widget" }
    ), "https://www.youtube.com");
  }
  const info = data.info || {};
  if (typeof info.playerState === "number" && !window.__state.states.includes(info.playerState)) {
    window.__state.states.push(info.playerState);
    log("playerState " + info.playerState);
  }
  if (typeof info.currentTime === "number") {
    const t = Math.round(info.currentTime * 10) / 10;
    if (window.__state.times.at(-1) !== t) window.__state.times.push(t);
  }
});

// The frame answers nothing until it is told someone is listening.
const handshake = setInterval(() => {
  frame.contentWindow && frame.contentWindow.postMessage(JSON.stringify(
    { event: "listening", id: 1, channel: "widget" }
  ), "https://www.youtube.com");
}, 500);
setTimeout(() => clearInterval(handshake), ${WAIT_MS});
</script>
</body>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytfree-origin-"));
fs.writeFileSync(path.join(dir, "index.html"), page(VIDEO));

// The control needs a real http origin, so serve the same bytes over one.
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(page(VIDEO));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// The globally installed playwright-core wants a browser build that is not on
// this machine; the one that is, is Chrome for Testing 1208. Named explicitly
// rather than installed, so the spike adds nothing to the machine.
const CHROME =
  os.homedir() +
  "/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app" +
  "/Contents/MacOS/Google Chrome for Testing";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  // Autoplay without a gesture, or "did not play" would mean nothing.
  args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});

async function run(label, url) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(WAIT_MS);
  const state = await p.evaluate(() => window.__state);
  const log = await p.evaluate(() => window.__log);
  await ctx.close();

  // Playing is the only thing that counts: a channel that opens and a player
  // that then refuses is exactly what mobile got.
  const played = state.times.length > 1 || state.states.includes(1);
  console.log(`\n=== ${label}  (${url.replace(/\?.*/, "")})`);
  for (const line of log) console.log("   " + line);
  console.log(`   → channel ${state.firstMessageMs === null ? "NEVER OPENED" : "open in " + (state.firstMessageMs / 1000).toFixed(1) + "s"}`);
  console.log(`   → errors: ${state.errors.length ? state.errors.join(", ") : "none"}`);
  console.log(`   → currentTime samples: ${state.times.slice(0, 8).join(", ") || "none"}`);
  console.log(`   → VERDICT: ${played ? "PLAYS" : "DID NOT PLAY"}`);
  return { played, state };
}

const control = await run("CONTROL  http origin", `http://127.0.0.1:${port}/`);
const subject = await run("SUBJECT  file:// origin", `file://${path.join(dir, "index.html")}`);

await browser.close();
server.close();

console.log("\n---------------------------------------------------------------");
if (!control.played) {
  console.log("PROBE INCONCLUSIVE — even the http control did not play, so the");
  console.log("harness is wrong or the video is unavailable. Fix before reading");
  console.log("anything into the subject run.");
} else if (subject.played) {
  console.log("Non-http origin PLAYED. The desktop iframe route is alive and the");
  console.log("in-Obsidian spike is worth installing to confirm at app://.");
} else {
  console.log("Non-http origin REFUSED" + (subject.state.errors.length ? ` (${subject.state.errors.join(", ")})` : "") + ", while http played.");
  console.log("Same shape as the mobile result. Expect app://obsidian.md to");
  console.log("refuse too — treat <webview> as the desktop fallback route.");
}
