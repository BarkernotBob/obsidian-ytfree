/**
 * YouTube's own player, in the player's own picture (GitHub #25, part 2).
 *
 * Mounted over the stage — where our `<video>` is — so the note, the bar and
 * the layout stay as they are, and YouTube's own fullscreen button is the only
 * fullscreen. It frames the hosted page (`docs/player/index.html`), because
 * Obsidian iOS can't frame the embed itself (error 153, issue 004).
 */

import { parsePlayerMessage, PLAYER_ORIGIN, playerErrorText, playerPageUrl, qualityLabel } from "../youtube-player.ts";

/** How long the quality chip stays after it changes. */
const BADGE_MS = 4000;

export interface YouTubeEmbed {
  /** Takes the player down; answers the second the reader got to. */
  close(): number;
}

export function mountYouTubePlayer(host: HTMLElement, videoId: string, startAt: number, rate: number): YouTubeEmbed {
  let lastTime = startAt;
  let lastQuality = "";
  let timer: number | null = null;

  const box = host.createDiv({ cls: "ytfree-yt-embed" });
  const frame = box.createEl("iframe", {
    cls: "ytfree-yt-embed-frame",
    attr: {
      src: playerPageUrl(videoId, startAt, rate),
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

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== PLAYER_ORIGIN || e.source !== frame.contentWindow) return;
    const msg = parsePlayerMessage(e.data);
    if (!msg) return;
    if (msg.type === "error") {
      flash(playerErrorText(msg.code), true);
    } else if (msg.type === "status") {
      if (msg.time > 0) lastTime = msg.time;
      if (msg.quality && msg.quality !== lastQuality) {
        lastQuality = msg.quality;
        flash(`YouTube player · ${qualityLabel(msg.quality)}`);
      }
    }
  };
  window.addEventListener("message", onMessage);

  return {
    close() {
      window.removeEventListener("message", onMessage);
      if (timer !== null) window.clearTimeout(timer);
      // Stops YouTube's sound at once; a detached frame can play on briefly.
      frame.src = "about:blank";
      box.remove();
      return lastTime;
    },
  };
}
