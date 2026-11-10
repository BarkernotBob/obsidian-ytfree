/*
 * Spike — can a <webview> be the fallback player when yt-dlp is fully dead?
 *
 * Plain JS, no build step, separate plugin id, desktop only. It cannot disturb
 * the real plugin; nothing it does touches ytfree's settings, notes or data.
 *
 * WHY NOT AN IFRAME. Already answered, twice. Mobile: error 153 on all eight
 * host/param combinations, because `capacitor://localhost` is not an http(s)
 * origin (issue 004). Desktop, measured 2026-07-31 by `origin-probe.mjs`: an
 * identical harness plays over http://127.0.0.1 and gets error 153 from
 * `file://`. `app://obsidian.md` is a custom scheme like both of the failures,
 * so the iframe is not the desktop fallback either.
 *
 * A <webview> has no origin problem: it *is* youtube.com, top level, exactly
 * like the sign-in modal that already ships in `src/desktop/signin.ts`. The
 * open questions are therefore not "does it play" but "can the note still
 * drive it and still be typed in", which is what decides whether timestamps
 * keep stamping.
 *
 * Put ```ytfree-spike``` in a scratch note (optionally `videoId mode`, where
 * mode is watch|embed) and read the table in README.md.
 */

const { Plugin, Notice } = require("obsidian");

const DEFAULT_VIDEO = "h0EGCnBjTVk";

/** How often the poll asks the page where it is. */
const POLL_MS = 250;

/**
 * The page-side probe. One round trip, everything the fallback would need:
 * where the video is, whether it is running, and whether what is on screen is
 * an ad rather than the video (YouTube marks that on the player container).
 */
const PROBE = `(() => {
  const v = document.querySelector('video');
  if (!v) return null;
  const p = document.querySelector('.html5-video-player');
  return {
    t: v.currentTime,
    d: isFinite(v.duration) ? v.duration : 0,
    paused: v.paused,
    rate: v.playbackRate,
    ad: !!(p && p.classList.contains('ad-showing')),
  };
})()`;

module.exports = class FallbackSpike extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor("ytfree-spike", (source, el, ctx) => {
      const [id, mode] = source.trim().split(/\s+/);
      new SpikeBlock(this, el, id || DEFAULT_VIDEO, mode === "embed" ? "embed" : "watch").mount();
    });
    new Notice("YT Free fallback spike loaded");
  }
};

class SpikeBlock {
  constructor(plugin, host, videoId, mode) {
    this.plugin = plugin;
    this.host = host;
    this.videoId = videoId;
    this.mode = mode;
    this.lines = [];
    // What a synchronous reader (the stamp handler) would see, and when it was
    // last refreshed. Drift between the two is the whole W5 question.
    this.cached = { t: 0, at: 0, paused: true, ad: false, rate: 1 };
    this.samples = [];
  }

  mount() {
    const wrap = this.host.createDiv();
    wrap.style.cssText = "border:1px solid var(--background-modifier-border);border-radius:8px;padding:10px";

    wrap.createEl("div", {
      text: `webview spike — ${this.videoId} (${this.mode})`,
    }).style.cssText = "font-weight:600;margin-bottom:8px";

    // Fixed 16:9 reserved before anything loads, so nothing below moves when
    // the view appears. Same no-reflow rule the real player lives by.
    const box = wrap.createDiv();
    box.style.cssText =
      "position:relative;width:100%;aspect-ratio:16/9;background:var(--background-secondary);border-radius:6px;overflow:hidden";

    const src =
      this.mode === "embed"
        ? `https://www.youtube.com/embed/${this.videoId}?playsinline=1&rel=0`
        : `https://www.youtube.com/watch?v=${this.videoId}`;

    // No `useragent` attribute, deliberately: see the header of
    // src/desktop/signin.ts — spoofing it is what trips Google's block.
    const view = document.createElement("webview");
    view.setAttribute("src", src);
    view.setAttribute("allowpopups", "false");
    view.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    box.appendChild(view);
    this.view = view;

    view.addEventListener("dom-ready", () => {
      this.log("dom-ready");
      this.startPoll();
    });
    view.addEventListener("did-fail-load", (e) => this.log("did-fail-load " + e.errorDescription));

    const row = wrap.createDiv();
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-top:8px";
    this.btn(row, "Play", () => this.exec("document.querySelector('video').play()"));
    this.btn(row, "Pause", () => this.exec("document.querySelector('video').pause()"));
    this.btn(row, "Seek 2:00", () => this.seek(120));
    this.btn(row, "Seek 8:00", () => this.seek(480));
    this.btn(row, "Rate 1.5", () => this.exec("document.querySelector('video').playbackRate=1.5"));
    this.btn(row, "Read time now (sync)", () => this.readSync());
    this.btn(row, "Latency ×20", () => this.latency());
    this.btn(row, "Where is focus?", () => this.focusProbe());
    this.btn(row, "Copy log", () => this.copy());

    const note = wrap.createEl("p");
    note.style.cssText = "font-size:12px;color:var(--text-muted);margin:8px 0 0";
    note.setText(
      "W6 is the one to do by hand: start the video, click the picture, then type a line in this note. " +
        "If the characters land in the note, stamping survives. If they go into the webview, it does not.",
    );

    this.logEl = wrap.createEl("pre");
    this.logEl.style.cssText =
      "height:180px;overflow:auto;font-size:11px;line-height:1.35;white-space:pre-wrap;user-select:text;background:var(--background-secondary);padding:8px;border-radius:6px;margin-top:8px";

    this.log("host origin: " + window.location.origin);
  }

  btn(parent, label, onClick) {
    const b = parent.createEl("button", { text: label });
    b.addEventListener("click", onClick);
    return b;
  }

  log(message) {
    this.lines.push(new Date().toLocaleTimeString() + "  " + message);
    if (this.logEl) {
      this.logEl.textContent = this.lines.join("\n");
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  }

  async exec(code) {
    try {
      return await this.view.executeJavaScript(code);
    } catch (err) {
      this.log("executeJavaScript threw: " + (err && err.message));
      return null;
    }
  }

  async seek(seconds) {
    const before = Date.now();
    await this.exec(`document.querySelector('video').currentTime=${seconds};document.querySelector('video').play()`);
    window.setTimeout(async () => {
      const now = await this.exec(PROBE);
      const landed = now && Math.abs(now.t - seconds) <= 3;
      this.log(
        `seek → ${seconds}s: ${landed ? "PASS" : "FAIL"} (landed ${now ? now.t.toFixed(1) : "?"}s, ` +
          `${Date.now() - before}ms)`,
      );
    }, 900);
  }

  /**
   * The poll that would back a synchronous `currentTime`. Between ticks the
   * value is dead-reckoned from the playback rate, because the stamp handler
   * runs on a keystroke and cannot await anything.
   */
  startPoll() {
    if (this.timer) return;
    this.timer = window.setInterval(async () => {
      const s = await this.exec(PROBE);
      if (!s) return;
      const predicted = this.syncTime();
      if (this.cached.at) this.samples.push(Math.abs(predicted - s.t));
      this.cached = { t: s.t, at: Date.now(), paused: s.paused, ad: s.ad, rate: s.rate };
      if (s.ad !== this.lastAd) {
        this.lastAd = s.ad;
        this.log(s.ad ? "AD SHOWING — position is the ad's, not the video's" : "ad over");
      }
    }, POLL_MS);
    this.plugin.register(() => window.clearInterval(this.timer));
  }

  /** What the stamp handler would get, with no await anywhere. */
  syncTime() {
    if (this.cached.paused) return this.cached.t;
    return this.cached.t + ((Date.now() - this.cached.at) / 1000) * (this.cached.rate || 1);
  }

  async readSync() {
    const predicted = this.syncTime();
    const truth = await this.exec(PROBE);
    this.log(
      `sync read ${predicted.toFixed(2)}s vs actual ${truth ? truth.t.toFixed(2) : "?"}s` +
        (truth ? ` — off by ${Math.abs(predicted - truth.t).toFixed(2)}s` : ""),
    );
    if (this.samples.length) {
      const worst = Math.max(...this.samples);
      const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      this.log(`drift over ${this.samples.length} ticks: mean ${mean.toFixed(2)}s, worst ${worst.toFixed(2)}s`);
    }
  }

  /** How long a round trip costs, which is why the value has to be cached. */
  async latency() {
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await this.exec(PROBE);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    this.log(
      `executeJavaScript ×20: median ${times[10].toFixed(1)}ms, worst ${times[19].toFixed(1)}ms`,
    );
  }

  focusProbe() {
    const el = document.activeElement;
    this.log(
      `activeElement <${el ? el.tagName.toLowerCase() : "none"}${el && el.className ? " ." + String(el.className).split(" ")[0] : ""}>`,
    );
  }

  copy() {
    navigator.clipboard.writeText(this.lines.join("\n")).then(
      () => new Notice("Log copied"),
      () => new Notice("Copy failed — select the text"),
    );
  }
}
