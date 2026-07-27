import Hls from "hls.js";
import { ResolveMode, ResolvedStream } from "./resolver";

export type StreamProvider = (
  mode: ResolveMode,
  forceRefresh: boolean,
) => Promise<ResolvedStream>;

const MAX_CONSECUTIVE_RECOVERIES = 3;
const RECOVERY_COOLDOWN_MS = 2000;

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
  ) {
    this.video = container.createEl("video", {
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
      if (document.fullscreenElement) void document.exitFullscreen();
      else void this.video.requestFullscreen().catch(() => { /* ignore */ });
    });

    if (this.onTimestamp) {
      button("Timestamp", "Insert timestamp at cursor", () => {
        this.onTimestamp?.(Math.floor(this.video.currentTime));
      });
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

  private async togglePip(): Promise<void> {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      this.onStatus("Picture-in-Picture is unavailable for this video.");
      window.setTimeout(() => this.onStatus(null), 4000);
    }
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
