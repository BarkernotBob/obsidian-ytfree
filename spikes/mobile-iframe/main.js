/*
 * Spike for issue 004 — plain JS on purpose, no build step.
 *
 * Run 1 (2026-07-27) result:
 *   Q4 PASS  — `ytfree:` links intercept fine on iOS.
 *   Q2 PASS  — the postMessage channel itself works, both hosts, 8-23s to
 *              first message.
 *   Q1 FAIL  — nocookie showed a black box; youtube.com showed
 *              "Error 153 — Video player configuration error".
 *
 * Error 153 is YouTube refusing the embedding origin. This webview's origin is
 * `capacitor://localhost`, which is not an http(s) origin and cannot be one.
 *
 * The hypothesis this run tests: `enablejsapi=1` is what demands a valid
 * origin. Plain YouTube embeds play in Obsidian mobile notes every day, so the
 * failure is unlikely to be iframes-in-general — it is likely the JS API opt-in
 * specifically. If a plain embed plays, option B survives with seeking done by
 * remount-at-`?start=` instead of `seekTo`.
 *
 * So: a matrix. Two hosts x four param variants, one at a time, with the
 * verdict written from what actually happened rather than from what should.
 */

const { Plugin, Modal, Notice } = require("obsidian");

const DEFAULT_VIDEO = "h0EGCnBjTVk";

const HOSTS = {
  nocookie: "https://www.youtube-nocookie.com",
  youtube: "https://www.youtube.com",
};

// The four ways to ask for the same embed. Only the first has any chance of
// working if origin validation is the blocker; only the last three can seek
// without a reload.
const VARIANTS = {
  plain: {
    label: "plain — no JS API",
    params: [],
    api: false,
  },
  "api-no-origin": {
    label: "API, no origin (run 1: err 153)",
    params: ["enablejsapi=1", "widgetid=1"],
    api: true,
  },
  "api-origin-real": {
    label: "API + origin=capacitor://localhost",
    params: ["enablejsapi=1", "widgetid=1", "origin=capacitor%3A%2F%2Flocalhost"],
    api: true,
  },
  "api-origin-yt": {
    label: "API + origin=https://www.youtube.com",
    params: ["enablejsapi=1", "widgetid=1", "origin=https%3A%2F%2Fwww.youtube.com"],
    api: true,
  },
};

module.exports = class SpikePlugin extends Plugin {
  onload() {
    this.addCommand({
      id: "run",
      name: "Run mobile iframe spike",
      callback: () => new SpikeModal(this.app, this).open(),
    });
    this.addRibbonIcon("play-circle", "YT Free spike", () =>
      new SpikeModal(this.app, this).open(),
    );

    // Capture phase, so nothing else can swallow it first. Confirmed working.
    this.clickHandler = (evt) => {
      const anchor = evt.target && evt.target.closest && evt.target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (!href.startsWith("ytfree:")) return;
      evt.preventDefault();
      evt.stopPropagation();
      if (this.modal) this.modal.onSchemeLink(href);
      else new Notice("ytfree: link intercepted — " + href);
    };
    document.addEventListener("click", this.clickHandler, true);
  }

  onunload() {
    document.removeEventListener("click", this.clickHandler, true);
  }
};

class SpikeModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.videoId = DEFAULT_VIDEO;
    this.hostKey = "youtube";
    this.variantKey = "plain";
    this.lines = [];
    this.resetRunState();
  }

  resetRunState() {
    this.sawAnyMessage = false;
    this.sawReady = false;
    this.lastReportedTime = null;
    this.pendingSeek = null;
    this.queuedSeek = null;
    this.mountedAt = 0;
  }

  onOpen() {
    this.plugin.modal = this;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Issue 004 spike — run 2" });

    const hint = contentEl.createEl("p", {
      text:
        "Try 'plain' first. If a video plays, option B lives and seeking is done " +
        "by remounting. Then work down the API variants to see if any avoids error 153.",
    });
    hint.style.fontSize = "12px";
    hint.style.color = "var(--text-muted)";
    hint.style.marginTop = "0";

    // ---------------------------------------------------------------- inputs
    const controls = contentEl.createDiv();
    controls.style.display = "grid";
    controls.style.gridTemplateColumns = "1fr";
    controls.style.gap = "8px";
    controls.style.marginBottom = "10px";

    const idInput = controls.createEl("input", { type: "text", value: this.videoId });
    idInput.setAttribute("autocapitalize", "off");
    idInput.setAttribute("autocorrect", "off");
    idInput.setAttribute("placeholder", "video id");
    idInput.addEventListener("change", () => {
      this.videoId = idInput.value.trim() || DEFAULT_VIDEO;
    });

    const hostSelect = controls.createEl("select");
    for (const key of Object.keys(HOSTS)) {
      hostSelect.createEl("option", { value: key, text: HOSTS[key] });
    }
    hostSelect.value = this.hostKey;
    hostSelect.addEventListener("change", () => {
      this.hostKey = hostSelect.value;
    });

    const variantSelect = controls.createEl("select");
    for (const key of Object.keys(VARIANTS)) {
      variantSelect.createEl("option", { value: key, text: VARIANTS[key].label });
    }
    variantSelect.value = this.variantKey;
    variantSelect.addEventListener("change", () => {
      this.variantKey = variantSelect.value;
    });

    const mountRow = controls.createDiv();
    mountRow.style.display = "flex";
    mountRow.style.gap = "8px";
    this.button(mountRow, "Mount", () => this.mount(0));
    this.button(mountRow, "Mount at 5:00", () => this.mount(300));

    // ------------------------------------------------------------ the iframe
    // Fixed 16:9 box reserved before the frame loads, so nothing below it moves
    // when it appears. Same no-reflow rule the real player will need.
    this.frameBox = contentEl.createDiv();
    this.frameBox.style.position = "relative";
    this.frameBox.style.width = "100%";
    this.frameBox.style.aspectRatio = "16 / 9";
    this.frameBox.style.background = "var(--background-secondary)";
    this.frameBox.style.borderRadius = "6px";
    this.frameBox.style.overflow = "hidden";
    this.frameBox.style.marginBottom = "10px";

    this.placeholder = this.frameBox.createDiv({ text: "not mounted" });
    this.placeholder.style.position = "absolute";
    this.placeholder.style.inset = "0";
    this.placeholder.style.display = "flex";
    this.placeholder.style.alignItems = "center";
    this.placeholder.style.justifyContent = "center";
    this.placeholder.style.color = "var(--text-muted)";
    this.placeholder.style.fontSize = "12px";

    // --------------------------------------------------------------- actions
    const actions = contentEl.createDiv();
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    actions.style.marginBottom = "10px";

    this.button(actions, "Play", () => this.command("playVideo"));
    this.button(actions, "Seek 2:00", () => this.seek(120));
    this.button(actions, "Seek 8:00", () => this.seek(480));

    const linkWrap = contentEl.createDiv();
    linkWrap.style.marginBottom = "10px";
    linkWrap.style.fontSize = "13px";
    linkWrap.appendChild(document.createTextNode("Scheme test: "));
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "ytfree:" + this.videoId + ":180");
    anchor.textContent = "ytfree link → 3:00";
    linkWrap.appendChild(anchor);

    // ------------------------------------------------------------------- log
    this.logEl = contentEl.createEl("pre");
    this.logEl.style.height = "170px";
    this.logEl.style.overflow = "auto";
    this.logEl.style.fontSize = "11px";
    this.logEl.style.lineHeight = "1.35";
    this.logEl.style.whiteSpace = "pre-wrap";
    this.logEl.style.userSelect = "text";
    this.logEl.style.background = "var(--background-secondary)";
    this.logEl.style.padding = "8px";
    this.logEl.style.borderRadius = "6px";

    // What the frame shows is something only a pair of eyes can report. Run 1
    // came back with Q1 unanswered because there was nowhere to record it.
    const eyes = contentEl.createDiv();
    eyes.style.display = "flex";
    eyes.style.flexWrap = "wrap";
    eyes.style.gap = "8px";
    eyes.style.marginTop = "8px";
    this.button(eyes, "✓ plays", () => this.observed("PLAYS"));
    this.button(eyes, "✗ black", () => this.observed("black box"));
    this.button(eyes, "✗ err 153", () => this.observed("error 153"));
    this.button(eyes, "✗ other err", () => this.observed("some other error on screen"));
    this.button(eyes, "✓ inline", () => this.observed("stayed inline, no fullscreen takeover"));
    this.button(eyes, "✗ fullscreen", () => this.observed("took over the whole screen"));

    const footer = contentEl.createDiv();
    footer.style.display = "flex";
    footer.style.gap = "8px";
    footer.style.marginTop = "8px";
    this.button(footer, "Copy log", () => this.copyLog());

    this.onMessage = (evt) => this.handleMessage(evt);
    window.addEventListener("message", this.onMessage);

    this.log("origin: " + window.location.origin);
  }

  onClose() {
    window.removeEventListener("message", this.onMessage);
    window.clearInterval(this.handshake);
    this.plugin.modal = null;
    this.contentEl.empty();
  }

  // ------------------------------------------------------------------ helpers

  button(parent, label, onClick) {
    const b = parent.createEl("button", { text: label });
    b.style.flex = "0 0 auto";
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

  /** An eyes-only observation, tagged with what was actually mounted. */
  observed(what) {
    this.log("OBSERVED [" + this.hostKey + " / " + this.variantKey + "] " + what);
  }

  get host() {
    return HOSTS[this.hostKey];
  }

  get variant() {
    return VARIANTS[this.variantKey];
  }

  // -------------------------------------------------------------------- mount

  mount(startSeconds) {
    window.clearInterval(this.handshake);
    this.resetRunState();
    if (this.frame) this.frame.remove();
    if (this.placeholder) this.placeholder.style.display = "none";

    const start = Math.max(0, Math.floor(startSeconds || 0));
    // `playsinline=1` is what stops iOS taking over the whole screen on play.
    const params = ["playsinline=1", "rel=0", "start=" + start].concat(this.variant.params);
    const src = this.host + "/embed/" + this.videoId + "?" + params.join("&");

    this.frame = document.createElement("iframe");
    this.frame.setAttribute("src", src);
    this.frame.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    this.frame.setAttribute("allowfullscreen", "true");
    this.frame.setAttribute("playsinline", "true");
    this.frame.style.position = "absolute";
    this.frame.style.inset = "0";
    this.frame.style.width = "100%";
    this.frame.style.height = "100%";
    this.frame.style.border = "0";
    this.frame.addEventListener("load", () => this.log("iframe load event fired"));
    this.frame.addEventListener("error", () => this.log("iframe error event"));
    this.frameBox.appendChild(this.frame);

    this.mountStart = start;
    this.log("mount [" + this.hostKey + " / " + this.variantKey + "] start=" + start);

    if (!this.variant.api) {
      this.log("no JS API in this variant — judge it by eye, then use the buttons");
      return;
    }

    // The frame only talks after it is told to. Retry until it does; run 1
    // showed nocookie taking 23s, and a 12s window called that a failure when
    // it was impatience. Slow and silent are different findings.
    this.mountedAt = Date.now();
    let attempts = 0;
    this.handshake = window.setInterval(() => {
      attempts += 1;
      if (this.sawAnyMessage || attempts > 120) {
        window.clearInterval(this.handshake);
        if (!this.sawAnyMessage) this.log("no message from frame after 60s");
        return;
      }
      this.post({ event: "listening", id: 1, channel: "widget" });
    }, 500);
  }

  post(payload) {
    if (!this.frame || !this.frame.contentWindow) {
      this.log("no frame — mount first");
      return;
    }
    this.frame.contentWindow.postMessage(JSON.stringify(payload), this.host);
  }

  command(func, args) {
    if (!this.variant.api) {
      this.log("variant has no JS API — nothing to command");
      return;
    }
    this.post({ event: "command", func, args: args || [], id: 1, channel: "widget" });
  }

  /**
   * Seek by whatever means this variant has.
   *
   * The `plain` path is the real fallback under test: no JS API, so the only
   * way to reach a timestamp is to reload the frame at it. It works, and it
   * replays the pre-roll every single tap. Whether that is tolerable is the
   * decision this spike exists to inform.
   */
  seek(seconds) {
    if (!this.variant.api) {
      this.log("no API — remounting at " + seconds + "s (this replays the ad)");
      this.mount(seconds);
      return;
    }
    if (!this.sawReady) {
      // Firing into a frame that is not listening is how run 1 left Q3
      // untested. Queue instead.
      this.queuedSeek = seconds;
      this.log("queued seek to " + seconds + "s — frame not listening yet");
      return;
    }
    this.sendSeek(seconds);
  }

  sendSeek(seconds) {
    this.pendingSeek = seconds;
    this.command("seekTo", [seconds, true]);
    this.command("playVideo");
    this.log("sent seekTo " + seconds + " — watch for a currentTime near it");
  }

  onSchemeLink(href) {
    this.log("ytfree: intercepted " + href);
    const seconds = Number(href.split(":")[2] || 0);
    if (this.frame) this.seek(seconds);
    else this.mount(seconds);
  }

  // ----------------------------------------------------------------- messages

  handleMessage(evt) {
    if (!this.frame || evt.source !== this.frame.contentWindow) return;

    if (!this.sawAnyMessage) {
      this.sawAnyMessage = true;
      const elapsed = ((Date.now() - this.mountedAt) / 1000).toFixed(1);
      // How long this takes is a design input, not trivia: it decides whether a
      // timestamp tap can seek an existing frame or has to remount anyway.
      this.log("channel open, first message from " + evt.origin + " after " + elapsed + "s");
    }

    let data = evt.data;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        return;
      }
    }
    if (!data || typeof data !== "object") return;

    if (data.event === "onError" || (data.info && data.info.errorCode)) {
      this.log("PLAYER ERROR " + JSON.stringify(data.info || data).slice(0, 120));
    }

    if (data.event === "onReady" || data.event === "initialDelivery") {
      if (!this.sawReady) {
        this.sawReady = true;
        this.log("frame reports " + data.event);
        if (this.queuedSeek !== null) {
          const seconds = this.queuedSeek;
          this.queuedSeek = null;
          // A beat after initialDelivery: the frame is listening, but the
          // player behind it is not always ready to be commanded yet.
          window.setTimeout(() => this.sendSeek(seconds), 600);
        }
      }
    }

    const info = data.info || {};
    if (typeof info.currentTime === "number") {
      const t = Math.round(info.currentTime);
      if (t !== this.lastReportedTime) {
        this.lastReportedTime = t;
        this.log("currentTime " + t + "s");
        if (this.pendingSeek !== null && Math.abs(t - this.pendingSeek) <= 3) {
          this.log("SEEK PASS landed at " + t + "s (asked " + this.pendingSeek + ")");
          this.pendingSeek = null;
        }
      }
    }
    if (typeof info.playerState === "number") {
      this.log("playerState " + info.playerState);
    }
  }

  copyLog() {
    const text = this.lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => new Notice("Log copied"),
        () => new Notice("Copy failed — select the log text instead"),
      );
    } else {
      new Notice("No clipboard API — select the log text instead");
    }
  }
}
