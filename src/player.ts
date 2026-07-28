import Hls from "hls.js";
// Type-only, and it has to stay that way. A value import of these names pulled
// the whole resolver — and its `child_process` import — into every bundle that
// touches the player, which is one of the two reasons the plugin could not load
// on mobile.
import type { ResolveMode, ResolvedStream, StreamProvider } from "./stream.ts";

export type { StreamProvider };

const MAX_CONSECUTIVE_RECOVERIES = 3;
const RECOVERY_COOLDOWN_MS = 2000;

export interface PlayerOptions {
  /**
   * Where the `<video>` goes, when it is not the container itself. Mobile docks
   * the player in a fixed-aspect box that also holds the poster and the
   * fallback, so the media has its own host.
   */
  mediaHost?: HTMLElement;
  /** Shown at the end of the control row. Mobile uses it to close the player. */
  onClose?: () => void;
}

/**
 * Wraps a native <video> element and keeps it playing across stream-URL expiry.
 *
 * Resolved googlevideo URLs are both time-limited and IP-locked, so they die in
 * two ordinary situations: a long session crossing the expiry window, and the
 * laptop changing networks. Both surface as a load error, and both are fixed the
 * same way — re-resolve, seek back, resume. The user should never see the seam.
 */
export class YtFreePlayer {
  readonly video: HTMLVideoElement;
  private hls: Hls | null = null;
  private recoveries = 0;
  private recovering = false;
  private destroyed = false;
  private lastRecoveryAt = 0;
  private upgraded = false;
  /** Survives source swaps; the <video> element resets these on every load. */
  private playbackRate = 1;
  /** True only while playback is paused *by us* because the user is typing. */
  private pausedByTyping = false;
  /** Has this player ever started? Stops an untouched note stamping 0:00. */
  private started = false;
  /**
   * Playing a file off disk. Local files do not expire and are not IP-locked,
   * so the whole recovery path is inert — and must stay inert, or a transient
   * decode error would drag the player back onto the network.
   */
  private local = false;
  private downloadBtn: HTMLButtonElement | null = null;

  constructor(
    private container: HTMLElement,
    private provider: StreamProvider,
    private onStatus: (message: string | null) => void,
    private onTimestamp?: (seconds: number) => void,
    private onDownload?: () => void,
    private options: PlayerOptions = {},
  ) {
    this.video = (options.mediaHost ?? container).createEl("video", {
      cls: "ytfree-video",
      attr: { controls: "", playsinline: "", preload: "metadata" },
    });

    this.buildControls();

    // Native error path (direct mp4, and some HLS failures).
    this.video.addEventListener("error", () => {
      if (this.video.error) void this.recover("playback error");
    });

    // Any play the user starts themselves ends our ownership of the pause, so a
    // later idle timer can't claim credit for a state it didn't cause.
    this.video.addEventListener("play", () => {
      this.pausedByTyping = false;
      this.started = true;
    });
  }

  /**
   * Chromium hides Picture-in-Picture and playback speed behind the native
   * overflow ("...") menu. This row surfaces them, plus skip and timestamp,
   * without replacing the native scrubber and volume, which work well.
   *
   * The same row is built on mobile. It was originally dropped there on the
   * theory that iOS's native controls already offered all of it — they do not
   * offer 10-second skip or a speed picker without a long detour, and reaching
   * PiP means an overlay button that appears only while playing.
   *
   * Every control has a fixed size and no layout-affecting state change, so
   * pressing one never moves its neighbours or the note content around it.
   */
  private buildControls(): void {
    const bar = this.container.createDiv({ cls: "ytfree-controls" });

    const button = (label: string, title: string, onClick: () => void) => {
      const el = bar.createEl("button", { cls: "ytfree-btn", text: label, attr: { title } });
      el.type = "button";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        onClick();
      });
      return el;
    };

    const playBtn = button("Play", "Play or pause", () => {
      if (this.video.paused) void this.video.play().catch(() => { /* ignore */ });
      else this.video.pause();
    });
    playBtn.addClass("ytfree-btn-play");
    // Text swap only — the button keeps a fixed width, so nothing shifts.
    this.video.addEventListener("play", () => playBtn.setText("Pause"));
    this.video.addEventListener("pause", () => playBtn.setText("Play"));

    button("−10s", "Back 10 seconds", () => {
      this.video.currentTime = Math.max(0, this.video.currentTime - 10);
    });
    button("+10s", "Forward 10 seconds", () => {
      this.video.currentTime = this.video.currentTime + 10;
    });

    const speed = bar.createEl("select", { cls: "ytfree-speed", attr: { title: "Playback speed" } });
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      speed.createEl("option", { text: `${rate}×`, value: String(rate) });
    }
    speed.value = "1";
    speed.addEventListener("change", () => {
      this.playbackRate = Number(speed.value);
      this.video.playbackRate = this.playbackRate;
    });

    button("PiP", "Picture-in-Picture", () => {
      void this.togglePip();
    });

    button("Fullscreen", "Fullscreen", () => {
      void this.toggleFullscreen();
    });

    if (this.onTimestamp) {
      button("Timestamp", "Insert timestamp at cursor", () => {
        this.onTimestamp?.(Math.floor(this.video.currentTime));
      });
    }

    if (this.options.onClose) {
      button("Close", "Close the player", () => this.options.onClose?.());
    }

    if (this.onDownload) {
      // Fixed width, and only ever a text swap inside it: "Download" → "12%" →
      // "Downloaded". The row cannot reflow while a download runs.
      this.downloadBtn = button("Download", "Download this video for offline", () => {
        this.onDownload?.();
      });
      this.downloadBtn.addClass("ytfree-btn-download");
    }
  }

  /** Progress feedback on the Download button itself. */
  setDownloadState(state: "idle" | "running" | "done", percent?: number): void {
    if (!this.downloadBtn) return;
    if (state === "running") {
      this.downloadBtn.setText(percent === undefined ? "…" : `${Math.round(percent)}%`);
      this.downloadBtn.disabled = true;
    } else if (state === "done") {
      this.downloadBtn.setText("Downloaded");
      this.downloadBtn.disabled = true;
    } else {
      this.downloadBtn.setText("Download");
      this.downloadBtn.disabled = false;
    }
  }

  /** Say something for a few seconds, then go quiet again. */
  private flashStatus(message: string): void {
    this.onStatus(message);
    window.setTimeout(() => this.onStatus(null), 4000);
  }

  /**
   * Picture-in-Picture, on both engines.
   *
   * iOS implements none of the standard API on a `<video>` — no
   * `requestPictureInPicture`, no `document.pictureInPictureElement`. It has
   * WebKit's presentation-mode API instead, which does the same job.
   */
  private async togglePip(): Promise<void> {
    const el = this.video as HTMLVideoElement & {
      webkitSetPresentationMode?: (mode: string) => void;
      webkitSupportsPresentationMode?: (mode: string) => boolean;
      webkitPresentationMode?: string;
    };
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (typeof this.video.requestPictureInPicture === "function") {
        await this.video.requestPictureInPicture();
        return;
      }
    } catch {
      // Standard API present but refused — fall through to WebKit's.
    }

    if (el.webkitSupportsPresentationMode?.("picture-in-picture")) {
      el.webkitSetPresentationMode?.(
        el.webkitPresentationMode === "picture-in-picture" ? "inline" : "picture-in-picture",
      );
      return;
    }
    this.flashStatus("Picture-in-Picture is unavailable for this video.");
  }

  /**
   * Fullscreen, on both engines.
   *
   * An iPhone has no element-level Fullscreen API at all — only the video's own
   * `webkitEnterFullscreen`, and that one refuses until there is loaded media
   * to show, which is why the fallback message says so rather than failing
   * silently.
   */
  private async toggleFullscreen(): Promise<void> {
    const el = this.video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitSupportsFullscreen?: boolean;
    };
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (typeof this.video.requestFullscreen === "function") {
        await this.video.requestFullscreen();
        return;
      }
    } catch {
      // Same as above: fall through rather than dead-end.
    }

    if (el.webkitSupportsFullscreen) el.webkitEnterFullscreen?.();
    else this.flashStatus("Fullscreen is not available until the video is playing.");
  }

  /**
   * Load in two stages so playback starts in ~4s instead of ~28s.
   *
   * Stage 1 is the fast 360p resolve, awaited so the caller can report a real
   * failure. Stage 2 fetches the 1080p HLS manifest in the background and swaps
   * it in at the same playback position — deliberately not awaited.
   */
  async load(upgradeToHighQuality: boolean): Promise<void> {
    const stream = await this.provider("fast", false);
    this.attach(stream, 0, false);
    if (upgradeToHighQuality) void this.upgrade();
  }

  /**
   * Play a file from disk. No yt-dlp, no resolve, no expiry — first frame is
   * immediate.
   *
   * `onFail` exists because a local file can be corrupt, truncated by a crashed
   * download, or on an unmounted volume. Rather than showing a dead player, the
   * caller is told to fall back to streaming.
   */
  loadLocal(url: string, onFail: () => void): void {
    this.local = true;
    this.teardownHls();
    const fail = () => {
      if (!this.local) return;
      this.local = false;
      onFail();
    };
    this.video.addEventListener("error", fail, { once: true });
    this.video.src = url;
    this.video.load();
  }

  /**
   * Swap a streaming player onto a freshly downloaded file without interrupting
   * it — same position, same play state. Reuses the quality-upgrade path, which
   * already exists to do exactly this for a different reason.
   */
  swapToLocal(url: string): void {
    if (this.destroyed) return;
    const resumeAt = this.video.currentTime;
    const wasPlaying = this.isPlaying;

    this.local = true;
    this.teardownHls();
    this.video.src = url;
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        if (resumeAt > 0) this.video.currentTime = resumeAt;
        this.video.playbackRate = this.playbackRate;
        if (wasPlaying) void this.video.play().catch(() => { /* ignore */ });
      },
      { once: true },
    );
    this.video.load();
  }

  get isLocal(): boolean {
    return this.local;
  }

  private async upgrade(): Promise<void> {
    let stream: ResolvedStream;
    try {
      stream = await this.provider("quality", false);
    } catch {
      return; // 360p already plays; a failed upgrade is not worth interrupting for.
    }
    if (this.destroyed || this.recovering || this.local) return;
    if (!stream.isHls) return; // no quality gain, so don't disturb playback

    const resumeAt = this.video.currentTime;
    const wasPlaying = !this.video.paused && !this.video.ended;
    this.upgraded = true;
    this.attach(stream, resumeAt, wasPlaying);
  }

  private attach(stream: ResolvedStream, resumeAt: number, autoplay: boolean): void {
    if (this.destroyed) return;
    this.teardownHls();

    const volume = this.video.volume;
    const muted = this.video.muted;

    const resume = () => {
      if (resumeAt > 0) this.video.currentTime = resumeAt;
      // A quality upgrade or refresh must not quietly reset how the user set
      // the player up.
      this.video.playbackRate = this.playbackRate;
      this.video.volume = volume;
      this.video.muted = muted;
      if (autoplay) void this.video.play().catch(() => { /* user gesture may be required */ });
    };

    if (stream.isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      this.hls = hls;
      hls.loadSource(stream.url);
      hls.attachMedia(this.video);
      hls.on(Hls.Events.MANIFEST_PARSED, resume);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        // A fatal network error on a manifest is what an expired URL looks like.
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          void this.recover("stream expired");
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          void this.recover("fatal player error");
        }
      });
    } else {
      this.video.src = stream.url;
      this.video.addEventListener("loadedmetadata", resume, { once: true });
      this.video.load();
    }
  }

  /** Re-resolve the stream and resume from wherever playback was. */
  private async recover(reason: string): Promise<void> {
    if (this.destroyed || this.recovering) return;
    // A local file has nothing to re-resolve. Its failure path is loadLocal's
    // onFail, which falls back to streaming once, deliberately.
    if (this.local) return;

    if (Date.now() - this.lastRecoveryAt > 60_000) this.recoveries = 0;

    if (this.recoveries >= MAX_CONSECUTIVE_RECOVERIES) {
      this.onStatus("Playback failed repeatedly. Try `brew upgrade yt-dlp`, then reopen this note.");
      return;
    }

    this.recovering = true;
    this.recoveries += 1;
    this.lastRecoveryAt = Date.now();

    const resumeAt = this.video.currentTime;
    const wasPlaying = !this.video.paused && !this.video.ended;
    this.onStatus(`Refreshing stream (${reason})…`);

    try {
      if (this.recoveries > 1) {
        await new Promise((r) => setTimeout(r, RECOVERY_COOLDOWN_MS));
      }
      // Recover in whatever quality is currently playing, so a refresh never
      // silently downgrades the picture.
      const stream = await this.provider(this.upgraded ? "quality" : "fast", true);
      this.attach(stream, resumeAt, wasPlaying);
      this.onStatus(null);
    } catch (err) {
      this.onStatus(`Could not refresh stream: ${(err as Error).message}`);
    } finally {
      this.recovering = false;
    }
  }

  seekTo(seconds: number): void {
    this.video.currentTime = seconds;
    void this.video.play().catch(() => { /* ignore */ });
  }

  /**
   * Seek even if nothing has loaded yet.
   *
   * On mobile the player is mounted but deliberately not resolved until it is
   * asked for, so a tapped timestamp routinely arrives before there is any
   * media to seek. Setting `currentTime` on an element with no duration is
   * silently dropped, which would look exactly like a broken link.
   */
  seekWhenReady(seconds: number): void {
    if (this.destroyed) return;
    if (this.video.readyState >= 1) {
      this.seekTo(seconds);
      return;
    }
    this.video.addEventListener("loadedmetadata", () => this.seekTo(seconds), { once: true });
  }

  /**
   * Claim the user gesture before an `await` throws it away.
   *
   * iOS only lets a media element start playing if `load()` or `play()` was
   * called during a real user interaction, and resolving a stream takes a
   * network round trip — by the time a URL comes back, the tap is long over and
   * `play()` is refused. Touching the element synchronously inside the tap
   * handler marks it as user-activated, and that survives the later `src` swap.
   */
  primeForGesture(): void {
    if (this.destroyed) return;
    try {
      this.video.load();
    } catch {
      // Nothing to load yet; the flag is what we were after.
    }
  }

  /** Start playback. Rejection is normal and not worth reporting. */
  play(): void {
    if (this.destroyed) return;
    void this.video.play().catch(() => { /* a gesture may still be required */ });
  }

  /**
   * Pause because the user started typing. A no-op when playback is already
   * stopped, which is what keeps a user's own pause from being taken over:
   * `pausedByTyping` only ever becomes true for a pause we performed.
   */
  pauseForTyping(): void {
    if (this.destroyed) return;
    if (this.video.paused || this.video.ended) return;
    this.pausedByTyping = true;
    this.video.pause();
  }

  /** Resume only what we paused. A user-paused video stays paused. */
  resumeAfterTyping(): void {
    if (this.destroyed) return;
    if (!this.pausedByTyping) return;
    this.pausedByTyping = false;
    void this.video.play().catch(() => { /* user gesture may be required */ });
  }

  get isPausedByTyping(): boolean {
    return this.pausedByTyping;
  }

  get isPlaying(): boolean {
    return !this.video.paused && !this.video.ended;
  }

  get hasPlayed(): boolean {
    return this.started;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  private teardownHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.teardownHls();
    this.video.removeAttribute("src");
    this.video.load();
    this.container.empty();
  }
}
