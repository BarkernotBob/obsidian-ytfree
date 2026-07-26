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

  constructor(
    private container: HTMLElement,
    private provider: StreamProvider,
    private onStatus: (message: string | null) => void,
  ) {
    this.video = container.createEl("video", {
      cls: "ytfree-video",
      attr: { controls: "", playsinline: "", preload: "metadata" },
    });

    // Native error path (direct mp4, and some HLS failures).
    this.video.addEventListener("error", () => {
      if (this.video.error) void this.recover("playback error");
    });
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

  private async upgrade(): Promise<void> {
    let stream: ResolvedStream;
    try {
      stream = await this.provider("quality", false);
    } catch {
      return; // 360p already plays; a failed upgrade is not worth interrupting for.
    }
    if (this.destroyed || this.recovering) return;
    if (!stream.isHls) return; // no quality gain, so don't disturb playback

    const resumeAt = this.video.currentTime;
    const wasPlaying = !this.video.paused && !this.video.ended;
    this.upgraded = true;
    this.attach(stream, resumeAt, wasPlaying);
  }

  private attach(stream: ResolvedStream, resumeAt: number, autoplay: boolean): void {
    if (this.destroyed) return;
    this.teardownHls();

    const resume = () => {
      if (resumeAt > 0) this.video.currentTime = resumeAt;
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
