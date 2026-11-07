/**
 * YouTube's own player, full-screen, on the phone (GitHub #25, part 2).
 *
 * Opened from the pop-out's Quality row. It frames the hosted page
 * (`docs/player/index.html`), shows what YouTube reports about quality, and
 * hands back the second the reader left off when it closes.
 */

import { App, Modal } from "obsidian";
import { parsePlayerMessage, PLAYER_ORIGIN, playerErrorText, playerPageUrl, qualityLabel } from "../youtube-player.ts";
import { formatTimestamp } from "../format.ts";

class YouTubePlayerModal extends Modal {
  private lastTime: number;
  private frame: HTMLIFrameElement | null = null;
  private line: HTMLElement | null = null;
  private onMessage = (e: MessageEvent) => this.handle(e);

  constructor(
    app: App,
    private readonly videoId: string,
    private readonly startAt: number,
    private readonly rate: number,
    private readonly done: (seconds: number | null) => void,
  ) {
    super(app);
    this.lastTime = startAt;
  }

  onOpen(): void {
    this.modalEl.addClass("ytfree-ytplayer-modal");
    this.contentEl.empty();
    this.line = this.contentEl.createDiv({ cls: "ytfree-ytplayer-line", text: "Opening YouTube's player…" });
    this.frame = this.contentEl.createEl("iframe", {
      cls: "ytfree-ytplayer-frame",
      attr: {
        src: playerPageUrl(this.videoId, this.startAt, this.rate),
        allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowfullscreen: "true",
        referrerpolicy: "strict-origin-when-cross-origin",
      },
    });
    window.addEventListener("message", this.onMessage);
  }

  private handle(e: MessageEvent): void {
    if (e.origin !== PLAYER_ORIGIN || e.source !== this.frame?.contentWindow) return;
    const msg = parsePlayerMessage(e.data);
    if (!msg || !this.line) return;
    if (msg.type === "error") {
      this.line.setText(playerErrorText(msg.code));
      return;
    }
    if (msg.type === "status") {
      if (msg.time > 0) this.lastTime = msg.time;
      this.line.setText(`YouTube player · ${qualityLabel(msg.quality)} · ${formatTimestamp(msg.time)}`);
    }
  }

  onClose(): void {
    window.removeEventListener("message", this.onMessage);
    // Stops YouTube's audio at once; a detached frame can keep playing briefly.
    if (this.frame) this.frame.src = "about:blank";
    this.contentEl.empty();
    this.done(this.lastTime);
  }
}

/** Resolves with the second the reader left off at, once the player closes. */
export function openYouTubePlayer(app: App, videoId: string, startAt: number, rate: number): Promise<number | null> {
  return new Promise((resolve) => new YouTubePlayerModal(app, videoId, startAt, rate, resolve).open());
}
