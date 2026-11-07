/*
 * Lock spike — the one question the music hub is blocked on.
 *
 * Track one ends while the phone is locked. Something has to call play() on
 * track two from an `ended` handler, which is not a user gesture. If WebKit
 * refuses that, a queue can never pause between tracks and the real build needs
 * gapless MSE instead of "swap the src". This answers that and nothing else.
 *
 * Plain CommonJS on purpose: no build step, no shared code with YT Free, no
 * shared state. Delete the folder and it is gone.
 *
 * Every log line is also appended to `log.txt` next to this file, so the answer
 * survives a webview reload and rides iCloud back to the Mac rather than being
 * read off a phone screen.
 */

const { Plugin, Modal, Notice, Platform, requestUrl } = require("obsidian");

/** Two public videos, both verified to carry itag 140 with a plain URL. */
const TRACKS = [
  { id: "kJQP7kiw5Fk", title: "Track one", artist: "Lock spike" },
  { id: "9bZkp7q19f0", title: "Track two", artist: "Lock spike" },
];

/** How much of track one to actually play. Long enough to lock the phone in. */
const TAIL_SECONDS = 20;

const ANDROID = {
  clientName: "ANDROID",
  clientVersion: "20.10.38",
  androidSdkVersion: 34,
  osName: "Android",
  osVersion: "14",
  hl: "en",
  gl: "US",
};
const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 14; en_US) gzip";

/**
 * itag 18, the 360p muxed file YT Free's phone player already plays. The
 * audio-only itag 140 resolved but WebKit refused it outright (2026-11-07:
 * NotSupportedError, media error code 4), so it can't answer the lock
 * question. An <audio> element plays a muxed file's sound and ignores the
 * picture, which is all this test needs.
 */
const AUDIO_ITAG = 18;

async function resolveAudio(videoId) {
  const response = await requestUrl({
    url: "https://www.youtube.com/youtubei/v1/player",
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ANDROID_UA },
    body: JSON.stringify({
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
      context: { client: ANDROID },
    }),
    throw: false,
  });
  const data = response.json;
  const status = data?.playabilityStatus?.status;
  if (status !== "OK") throw new Error("playabilityStatus: " + status);
  const formats = [
    ...(data?.streamingData?.formats ?? []),
    ...(data?.streamingData?.adaptiveFormats ?? []),
  ];
  const audio = formats.find((f) => f.itag === AUDIO_ITAG && f.url);
  if (!audio) throw new Error("no itag " + AUDIO_ITAG + " with a plain url");
  return audio.url;
}

const IOS = {
  clientName: "IOS",
  clientVersion: "20.10.4",
  deviceModel: "iPhone16,2",
  osName: "iPhone",
  osVersion: "18.3.2.22D82",
  hl: "en",
  gl: "US",
};
const IOS_UA =
  "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";

/** The same player request the plugin sends, for either client it already uses. */
async function playerResponse(videoId, ctx, ua) {
  const response = await requestUrl({
    url: "https://www.youtube.com/youtubei/v1/player",
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ videoId, contentCheckOk: true, racyCheckOk: true, context: { client: ctx } }),
    throw: false,
  });
  return response.json;
}

/**
 * Why did itag 140 fail when itag 18 from the same response plays? Measures,
 * on the phone, what googlevideo answers for each URL, and whether the iOS
 * client's HLS manifest offers an audio-only stream. Read-only: nothing plays
 * longer than a few seconds and nothing is stored but the log.
 */
class DiagnoseModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.lines = [];
  }

  log(msg) {
    const line = `[diag ${new Date().toISOString()}] ${msg}`;
    this.lines.push(line);
    if (this.logEl) this.logEl.setText(this.lines.join("\n"));
    void this.plugin.appendLog(line);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Lock spike — diagnose audio" });
    const input = contentEl.createEl("input", { type: "text", value: TRACKS[0].id });
    input.style.width = "100%";
    const go = contentEl.createEl("button", { text: "Run" });
    go.addEventListener("click", () => {
      go.disabled = true;
      const v = input.value.trim();
      const m = v.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
      void this.run(m ? m[1] : v);
    });
    this.logEl = contentEl.createEl("pre", { text: "" });
    this.logEl.style.maxHeight = "50vh";
    this.logEl.style.overflow = "auto";
    this.logEl.style.fontSize = "11px";
    this.logEl.style.whiteSpace = "pre-wrap";
    const copy = contentEl.createEl("button", { text: "Copy log" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.lines.join("\n"));
      new Notice("Log copied.");
    });
  }

  /** What googlevideo says to the first KB, outside the media element. */
  async probe(label, url) {
    const params = new URL(url).searchParams;
    this.log(`${label}: c=${params.get("c")} mime=${params.get("mime")} clen=${params.get("clen")} pot=${params.has("pot")}`);
    for (const [how, u, headers] of [
      ["Range header", url, { Range: "bytes=0-1023" }],
      ["&range=", url + "&range=0-1023", {}],
      // The whole file, for audio only: a muxed video file is tens of MB.
      ...(label.startsWith("itag 140") ? [["no range", url, {}]] : []),
    ]) {
      try {
        const r = await requestUrl({ url: u, method: "GET", headers, throw: false });
        const len = r.arrayBuffer ? r.arrayBuffer.byteLength : -1;
        this.log(`${label} [${how}]: HTTP ${r.status} type=${r.headers["content-type"] ?? r.headers["Content-Type"]} bytes=${len}`);
      } catch (err) {
        this.log(`${label} [${how}]: THREW ${err?.message ?? err}`);
      }
    }
  }

  /** Whether WebKit's own media loader gets anywhere with it, for 6 seconds. */
  tryElement(label, src) {
    return new Promise((resolve) => {
      const el = document.createElement("audio");
      el.setAttribute("playsinline", "");
      el.style.display = "none";
      document.body.appendChild(el);
      const done = (msg) => {
        this.log(`${label} <audio>: ${msg} t=${el.currentTime.toFixed(1)}`);
        el.pause();
        el.remove();
        resolve();
      };
      el.addEventListener("error", () => done(`error code=${el.error?.code} ${el.error?.message ?? ""}`), { once: true });
      setTimeout(() => done(el.currentTime > 0.5 ? "PLAYING" : `stuck readyState=${el.readyState}`), 6000);
      el.src = src;
      el.volume = 0.2;
      el.play().catch((err) => this.log(`${label} play(): ${err?.name}`));
    });
  }

  async run(videoId) {
    this.log(`video ${videoId}`);
    const android = await playerResponse(videoId, ANDROID, ANDROID_UA);
    this.log(`ANDROID status=${android?.playabilityStatus?.status}`);
    const all = [
      ...(android?.streamingData?.formats ?? []),
      ...(android?.streamingData?.adaptiveFormats ?? []),
    ];
    const audio = all.filter((f) => (f.mimeType ?? "").startsWith("audio/"));
    this.log("ANDROID audio formats: " + audio.map((f) => `${f.itag}${f.url ? "" : "(cipher)"} ${f.mimeType}`).join(" | "));
    for (const itag of [18, 140]) {
      const f = all.find((x) => x.itag === itag && x.url);
      if (!f) { this.log(`itag ${itag}: none with a plain url`); continue; }
      await this.probe(`itag ${itag}`, f.url);
      await this.tryElement(`itag ${itag}`, f.url);
    }

    const ios = await playerResponse(videoId, IOS, IOS_UA);
    this.log(`IOS status=${ios?.playabilityStatus?.status}`);
    const hls = ios?.streamingData?.hlsManifestUrl;
    if (!hls) {
      this.log("IOS: no HLS manifest for this video");
    } else {
      const r = await requestUrl({ url: hls, throw: false });
      const text = r.text ?? "";
      const audioLines = text.split("\n").filter((l) => /TYPE=AUDIO|audio only|CODECS="mp4a[^,"]*"/i.test(l));
      this.log(`IOS HLS: HTTP ${r.status}, ${text.length} chars, audio-only lines: ${audioLines.length}`);
      for (const l of audioLines.slice(0, 4)) this.log("  " + l.slice(0, 200));
      await this.tryElement("IOS HLS master", hls);
    }
    this.log("done");
  }
}

class LockSpikeModal extends Modal {
  /** `mode` is "same" (reuse one element) or "new" (build a second one). */
  constructor(app, plugin, mode) {
    super(app);
    this.plugin = plugin;
    this.mode = mode;
    this.audio = null;
    this.spare = null;
    this.lines = [];
    this.startedAt = 0;
  }

  log(text) {
    const since = this.startedAt ? ((Date.now() - this.startedAt) / 1000).toFixed(1) : "0.0";
    const line = `[+${since}s ${new Date().toISOString()}] vis=${document.visibilityState} ${text}`;
    this.lines.push(line);
    if (this.logEl) {
      this.logEl.setText(this.lines.join("\n"));
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
    void this.plugin.appendLog(line);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Lock spike — ${this.mode} element` });
    contentEl.createEl("p", {
      text:
        "1. Tap Start. 2. Lock the phone straight away. 3. Press play on the lock " +
        "screen if it paused. 4. Stay locked through the end of track one. " +
        "5. Unlock and read the log.",
    });

    // YouTube can refuse a given video signed out (LOGIN_REQUIRED). Paste two
    // links that already play in YT Free on this phone to rule that out.
    this.inputs = TRACKS.map((t, i) => {
      const input = contentEl.createEl("input", { type: "text", value: t.id });
      input.placeholder = `Track ${i + 1}: YouTube link or video ID`;
      input.style.width = "100%";
      input.style.marginBottom = "6px";
      return input;
    });

    const startButton = contentEl.createEl("button", { text: "Start" });
    startButton.addEventListener("click", () => {
      this.inputs.forEach((input, i) => {
        const v = input.value.trim();
        const m = v.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/);
        TRACKS[i].id = m ? m[1] : v;
      });
      startButton.disabled = true;
      void this.run();
    });

    this.logEl = contentEl.createEl("pre", { text: "" });
    this.logEl.style.maxHeight = "40vh";
    this.logEl.style.overflow = "auto";
    this.logEl.style.fontSize = "11px";
    this.logEl.style.whiteSpace = "pre-wrap";

    const copy = contentEl.createEl("button", { text: "Copy log" });
    copy.addEventListener("click", () => {
      void navigator.clipboard.writeText(this.lines.join("\n"));
      new Notice("Log copied.");
    });
  }

  /** Wire the events that say what actually happened, for either element. */
  watch(el, label) {
    for (const event of ["play", "playing", "pause", "ended", "stalled", "waiting", "error"]) {
      el.addEventListener(event, () => {
        const err = el.error ? ` code=${el.error.code}` : "";
        this.log(`${label}: ${event} t=${el.currentTime.toFixed(1)}${err}`);
      });
    }
    // One line a few seconds in is the difference between "play() resolved" and
    // "audio is actually advancing" — the failure mode that looks like success.
    let ticks = 0;
    el.addEventListener("timeupdate", () => {
      if (++ticks % 20 === 0) this.log(`${label}: advancing t=${el.currentTime.toFixed(1)}`);
    });
  }

  setNowPlaying(track) {
    const session = navigator.mediaSession;
    if (!session) return;
    if (typeof MediaMetadata === "function") {
      session.metadata = new MediaMetadata({ title: track.title, artist: track.artist });
    }
    try {
      session.setActionHandler("play", () => {
        this.log("lockscreen: play pressed");
        void this.current?.play();
      });
      session.setActionHandler("pause", () => {
        this.log("lockscreen: pause pressed");
        this.current?.pause();
      });
    } catch {
      // An action the OS has never heard of is not an error.
    }
  }

  async run() {
    this.startedAt = Date.now();
    this.log(`start, mode=${this.mode}, tracks=${TRACKS.map((t) => t.id).join(",")}`);

    // Both resolved up front: a failure to start track two must mean the play()
    // was refused, not that a network call was asleep behind a locked screen.
    let urls;
    try {
      urls = await Promise.all(
        TRACKS.map((t, i) =>
          resolveAudio(t.id).catch((err) => {
            throw new Error(`track ${i + 1} (${t.id}): ${err?.message ?? err}`);
          }),
        ),
      );
      this.log("resolved both tracks");
    } catch (err) {
      this.log("RESOLVE FAILED: " + (err?.message ?? String(err)));
      return;
    }

    this.audio = this.makeElement("one");
    this.current = this.audio;
    this.audio.src = urls[0];
    this.setNowPlaying(TRACKS[0]);

    this.audio.addEventListener(
      "loadedmetadata",
      () => {
        // Skip to the tail so the transition happens within the minute rather
        // than four minutes after the phone goes dark.
        const target = Math.max(0, this.audio.duration - TAIL_SECONDS);
        this.audio.currentTime = target;
        this.log(`seeked track one to ${target.toFixed(1)} of ${this.audio.duration.toFixed(1)}`);
      },
      { once: true },
    );

    this.audio.addEventListener("ended", () => void this.advance(urls[1]), { once: true });

    // This play() is inside the Start tap. It is the only gesture-backed one.
    try {
      await this.audio.play();
      this.log("track one play() resolved");
      new Notice("Playing. Lock the phone now.");
    } catch (err) {
      this.log(`track one play() REJECTED: ${err?.name}: ${err?.message}`);
    }
  }

  /** The whole experiment: a play() with no gesture behind it. */
  async advance(url) {
    this.log("=== track one ended — advancing ===");
    let el = this.audio;
    if (this.mode === "new") {
      // The variant that almost certainly loses on iOS, measured rather than
      // assumed: a brand new element has no playback permission of its own.
      this.audio.remove();
      el = this.makeElement("two");
      this.spare = el;
    }
    this.current = el;
    el.src = url;
    this.setNowPlaying(TRACKS[1]);
    try {
      await el.play();
      this.log("*** track two play() RESOLVED ***");
    } catch (err) {
      this.log(`*** track two play() REJECTED: ${err?.name}: ${err?.message} ***`);
    }
  }

  makeElement(label) {
    const el = document.createElement("audio");
    el.preload = "auto";
    el.setAttribute("playsinline", "");
    document.body.appendChild(el);
    el.style.display = "none";
    this.watch(el, "track " + label);
    return el;
  }

  onClose() {
    for (const el of [this.audio, this.spare]) {
      if (!el) continue;
      el.pause();
      el.remove();
    }
    this.log("closed");
  }
}

module.exports = class LockSpikePlugin extends Plugin {
  async onload() {
    this.logPath = this.manifest.dir + "/log.txt";
    for (const mode of ["same", "new"]) {
      this.addCommand({
        id: `lock-spike-${mode}`,
        name: `Lock spike: ${mode} element`,
        callback: () => new LockSpikeModal(this.app, this, mode).open(),
      });
    }
    this.addCommand({
      id: "lock-spike-diagnose",
      name: "Lock spike: diagnose audio",
      callback: () => new DiagnoseModal(this.app, this).open(),
    });
  }

  /** Append, never rewrite: the point is that the file outlives the webview. */
  async appendLog(line) {
    try {
      const adapter = this.app.vault.adapter;
      const device = Platform.isPhone ? "phone" : "desktop";
      const text = `${device} ${line}\n`;
      if (await adapter.exists(this.logPath)) await adapter.append(this.logPath, text);
      else await adapter.write(this.logPath, text);
    } catch {
      // The on-screen log is the primary; this is only the copy that travels.
    }
  }
};
