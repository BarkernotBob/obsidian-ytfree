/**
 * YouTube's own player, in the player's own picture (GitHub #25, part 2).
 *
 * Mounted over the stage — where our `<video>` is — so the note, the bar and
 * the layout stay as they are, and YouTube's own fullscreen button is the only
 * fullscreen. It frames the hosted page (`docs/player/index.html`), because
 * Obsidian iOS can't frame the embed itself (error 153, issue 004).
 */

import { Platform } from "obsidian";
import { logLine, parsePlayerMessage, PLAYER_ORIGIN, playerErrorText, playerPageUrl, qualityLabel } from "../youtube-player.ts";

/** How long the quality chip stays after it changes. */
const BADGE_MS = 4000;

/** How long the first-time tip stays if it isn't tapped away. */
const HINT_MS = 15000;
const HINT_KEY = "ytfree-yt-player-hint-seen";

/** Whether this device has already shown the tip. Storage can be refused; then it shows each time. */
function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintSeen(): void {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Shown again next time; harmless.
  }
}

export interface YouTubeEmbed {
  /** Takes the player down; answers the second the reader got to. */
  close(): number;
  /** Where YouTube's player is now (its last report, about once a second). */
  time(): number;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
}

/** What the player reports, about once a second and on every change. */
export type EmbedStatus = { time: number; duration: number; playing: boolean };

export function mountYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  startAt: number,
  rate: number,
  onStatus?: (status: EmbedStatus) => void,
  /** Each step of the background-play log (GitHub #25), as one line. */
  onLog?: (line: string) => void,
  /** False: cued at `startAt` and left paused (the YouTube button from a paused player). */
  play = true,
): YouTubeEmbed {
  const log = (from: "page" | "plugin", event: string, data?: Record<string, unknown>) =>
    onLog?.(logLine(new Date(), from, event, data));
  let lastTime = startAt;
  let lastQuality = "";
  let timer: number | null = null;

  const box = host.createDiv({ cls: "ytfree-yt-embed" });
  const frame = box.createEl("iframe", {
    cls: "ytfree-yt-embed-frame",
    attr: {
      src: playerPageUrl(videoId, startAt, rate, play),
      allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
      allowfullscreen: "true",
      referrerpolicy: "strict-origin-when-cross-origin",
    },
  });
  const badge = box.createDiv({ cls: "ytfree-yt-embed-badge is-visible", text: "YouTube player" });

  // Shown when something changes, then gone: a permanent label over the
  // picture is noise (Isaiah, 2026-11-10).
  const flash = (text: string, stay = false) => {
    badge.setText(text);
    badge.addClass("is-visible");
    if (timer !== null) window.clearTimeout(timer);
    timer = stay ? null : window.setTimeout(() => badge.removeClass("is-visible"), BADGE_MS);
  };
  flash("YouTube player");

  // Once per device: iOS gives PiP and background play only to YouTube's
  // fullscreen player, and no code of ours can open that (Isaiah, 2026-11-10).
  let hint: HTMLElement | null = null;
  let hintTimer: number | null = null;
  const dropHint = () => {
    if (hintTimer !== null) window.clearTimeout(hintTimer);
    hintTimer = null;
    hint?.remove();
    hint = null;
  };
  if (Platform.isMobile && !hintSeen()) {
    markHintSeen();
    hint = box.createDiv({ cls: "ytfree-yt-embed-hint" });
    hint.createSpan({ text: "For picture-in-picture or background play, tap YouTube's fullscreen button, then swipe home." });
    hint.createEl("button", { text: "OK", attr: { type: "button" } }).addEventListener("click", dropHint);
    hintTimer = window.setTimeout(dropHint, HINT_MS);
  }

  log("plugin", "opened", { video: videoId, at: Math.floor(startAt) });
  const onVisibility = () => log("plugin", document.hidden ? "app hidden" : "app visible");
  document.addEventListener("visibilitychange", onVisibility);

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== PLAYER_ORIGIN || e.source !== frame.contentWindow) return;
    const msg = parsePlayerMessage(e.data);
    if (!msg) return;
    if (msg.type === "log") {
      log("page", msg.event, msg.data);
    } else if (msg.type === "error") {
      log("page", "error", { code: msg.code });
      flash(playerErrorText(msg.code), true);
    } else if (msg.type === "status") {
      if (msg.time > 0) lastTime = msg.time;
      // YouTube's state 1 is playing; 3 (buffering) is not watch time.
      onStatus?.({ time: lastTime, duration: msg.duration, playing: msg.state === 1 });
      if (msg.quality && msg.quality !== lastQuality) {
        lastQuality = msg.quality;
        flash(`YouTube player · ${qualityLabel(msg.quality)}`);
      }
    }
  };
  window.addEventListener("message", onMessage);

  // The hosted page takes these (`docs/player/index.html`).
  const send = (data: Record<string, unknown>) =>
    frame.contentWindow?.postMessage({ source: "ytfree", ...data }, PLAYER_ORIGIN);

  return {
    time: () => lastTime,
    seek(seconds) {
      lastTime = seconds;
      send({ cmd: "seek", time: seconds });
    },
    play: () => send({ cmd: "play" }),
    pause: () => send({ cmd: "pause" }),
    close() {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) window.clearTimeout(timer);
      dropHint();
      log("plugin", "closed", { at: Math.floor(lastTime) });
      // Stops YouTube's sound at once; a detached frame can play on briefly.
      frame.src = "about:blank";
      box.remove();
      return lastTime;
    },
  };
}
