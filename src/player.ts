import Hls from "hls.js";
import { setIcon } from "obsidian";
import { formatTimestamp } from "./format.ts";
import type { SectionName } from "./sections.ts";
import { compressibleWindows, moveFor, secondsSaved, secondsSkipped } from "./silence.ts";
import type { PlaybackWindow, SilenceSource } from "./silence.ts";
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
  /**
   * Shown at the end of the control row. Mobile uses it to collapse the video
   * out of sight — the player keeps running and keeps its position, so this is
   * a view toggle, not a teardown.
   */
  onToggleCollapse?: () => void;
  /**
   * Mobile resolves the stream lazily, and until it has there is nothing for
   * Play, PiP or Fullscreen to act on. Every control that needs media calls
   * this first; it resolves immediately once the stream is up.
   */
  ensureLoaded?: () => Promise<void>;
  /**
   * Jump the note to one of its own sections. Draws the second row of the
   * control bar; absent, there is no second row at all — a fenced block in a
   * note with no video frontmatter has no sections to offer.
   */
  onJump?: (section: SectionName) => void;
  /**
   * Where this video got to last time, in seconds. Read at load time rather
   * than at construction, because on mobile the player is mounted long before
   * anything is resolved and the answer can change in between.
   */
  resumeAt?: () => number;
  /**
   * Where it has got to now. Called often — every few seconds of playback, on
   * pause, on seek, and once on teardown — so the receiver is the one that
   * decides what is worth writing down.
   */
  onProgress?: (seconds: number, duration: number) => void;
  /**
   * Smart Speed. Absent, the control is not drawn at all and the engine does
   * not exist; present, the toggle is always drawn — availability changes how
   * it looks, never whether it is there, so the row's geometry is fixed from
   * the moment it is built.
   */
  smartSpeed?: SmartSpeedOptions;
  /**
   * What to tell the operating system is playing. Read at play time rather than
   * captured, because on mobile the player is built before the note's metadata
   * has necessarily been read.
   */
  nowPlaying?: () => NowPlaying | null;
}

/** The lock screen's three fields. */
export interface NowPlaying {
  title: string;
  artist?: string;
  /** A thumbnail URL, or nothing — the OS draws its own placeholder. */
  artwork?: string;
}

export interface SmartSpeedOptions {
  /** Starting state, from the global setting. The toggle overrides it. */
  enabled: boolean;
  /** How fast a pause plays. Never slower than the user's chosen speed. */
  silenceRate: number;
  /** Told when the reader flips the toggle, so the setting can follow. */
  onToggle?: (enabled: boolean) => void;
  /**
   * The minimum silence length, in seconds — the user's setting, applied at the
   * last moment rather than baked into the map, so changing it takes effect on
   * the next frame with nothing to recompute.
   */
  minGap: number;
}

/** How often playback reports its position while it is running. */
const PROGRESS_INTERVAL_MS = 5000;

/**
 * A frame gap longer than this is not playback, it is a window that was hidden
 * or a laptop that was asleep. Counted as zero rather than as two minutes of
 * saved listening.
 */
const MAX_FRAME_SECONDS = 0.5;

/**
 * Which player currently owns `navigator.mediaSession` — there is one of those
 * per document, and a vault can have several players open at once.
 */
let nowPlayingOwner: YtFreePlayer | null = null;

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
  private collapseBtn: HTMLButtonElement | null = null;
  /** The lazy resolve, once asked for. Every later caller awaits the same one. */
  private loading: Promise<void> | null = null;
  /** Throttle for the position reports — see `trackProgress`. */
  private lastProgressAt = 0;
  private reportProgress: (() => void) | null = null;

  // --- Smart Speed. All inert unless `options.smartSpeed` was supplied.
  private smartBtn: HTMLButtonElement | null = null;
  private smartBadge: HTMLElement | null = null;
  private smartOn = false;
  /** Raw silence intervals from whichever producer last spoke. */
  private silenceWindows: PlaybackWindow[] = [];
  /** The same, filtered and trimmed at the current setting — what the loop reads. */
  private activeWindows: PlaybackWindow[] = [];
  private silenceSource: SilenceSource | null = null;
  /** Set once a producer has answered "there is no map and there won't be one". */
  private smartReason: string | null = null;
  private savedSeconds = 0;
  private smartRaf: number | null = null;
  private lastFrameAt = 0;
  /**
   * Has the engine ever written `playbackRate`? The guarantee is that a Smart
   * Speed that was never switched on leaves the rate strictly alone, so the
   * restore on toggle-off must not run for a toggle that was never on.
   */
  private smartTouchedRate = false;
  /** Kept so `destroy` can take it off `document`, which outlives this player. */
  private onVisibility: (() => void) | null = null;

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

    // Before anything can set a rate above 1: without this a 3× pause is a
    // chipmunk, and Chromium and WebKit spell the property differently.
    this.preservePitch();

    this.buildControls();
    this.trackSmartSpeed();

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

    this.trackProgress();
    this.trackNowPlaying();
  }

  /**
   * Tell the OS what is playing, so the lock screen and Control Centre show
   * this video with working buttons instead of nothing.
   *
   * What this cannot do is keep the audio running once the phone is locked or
   * the app is switched away from. That is the host app's audio session and its
   * background-audio entitlement — Obsidian's, not the plugin's — and no amount
   * of JavaScript reaches it. Everything on this side of that line is here, so
   * if the answer is ever yes, the controls are already right.
   */
  private trackNowPlaying(): void {
    const session = navigator.mediaSession;
    if (!session) return;

    this.video.addEventListener("play", () => {
      this.publishNowPlaying();
      session.playbackState = "playing";
    });
    for (const event of ["pause", "ended"]) {
      this.video.addEventListener(event, () => {
        session.playbackState = this.video.ended ? "none" : "paused";
      });
    }
    this.video.addEventListener("loadedmetadata", () => this.publishPosition());
  }

  private publishNowPlaying(): void {
    const session = navigator.mediaSession;
    if (!session) return;
    // There is one media session per document and any number of players, so
    // whoever started playing last owns it — and only that player may clear it.
    nowPlayingOwner = this;

    const now = this.options.nowPlaying?.();
    if (now && typeof MediaMetadata === "function") {
      session.metadata = new MediaMetadata({
        title: now.title,
        artist: now.artist ?? "",
        artwork: now.artwork ? [{ src: now.artwork }] : [],
      });
    }

    // Each in its own `try`: an OS that has never heard of an action throws on
    // that one alone, and the rest are still worth having.
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      // Through `withMedia`, like the Play button: on a phone the stream may
      // still be unresolved, and a lock-screen Play is as good a reason to
      // resolve it as a tap on the player.
      ["play", () => void this.withMedia(() => this.play())],
      ["pause", () => this.video.pause()],
      ["seekbackward", () => this.seekBy(-10)],
      ["seekforward", () => this.seekBy(10)],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") this.video.currentTime = details.seekTime;
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Unsupported action. Nothing to do and nothing to say.
      }
    }
    this.publishPosition();
  }

  /** Keeps the lock screen's scrubber honest. Called on the progress report. */
  private publishPosition(): void {
    const session = navigator.mediaSession;
    const duration = this.video.duration;
    if (!session?.setPositionState || !Number.isFinite(duration) || duration <= 0) return;
    try {
      session.setPositionState({
        duration,
        playbackRate: this.video.playbackRate || 1,
        position: Math.min(Math.max(0, this.video.currentTime), duration),
      });
    } catch {
      // WebKit throws if position and duration disagree, which they briefly do
      // mid-seek. The next report is a hundredth of a second away.
    }
  }

  /** Leave the lock screen empty rather than pointing at a closed note. */
  private clearNowPlaying(): void {
    const session = navigator.mediaSession;
    if (!session || nowPlayingOwner !== this) return;
    nowPlayingOwner = null;
    session.metadata = null;
    session.playbackState = "none";
    for (const action of ["play", "pause", "seekbackward", "seekforward", "seekto"] as const) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Same as setting them: an action the OS does not know is not an error.
      }
    }
  }

  private seekBy(seconds: number): void {
    const duration = this.video.duration;
    const target = this.video.currentTime + seconds;
    this.video.currentTime = Number.isFinite(duration)
      ? Math.min(Math.max(0, target), duration)
      : Math.max(0, target);
  }

  /**
   * Report where playback has got to, often enough to survive being killed.
   *
   * Closing Obsidian on a phone is not a teardown you get told about — iOS can
   * end the process outright — so waiting for `destroy()` would lose the last
   * however-many minutes. `timeupdate` fires about four times a second, which
   * is why it is throttled to one report every few seconds; `pause`, `ended`
   * and `seeked` are reported immediately, because each is a moment the reader
   * has just decided something about where they are.
   */
  private trackProgress(): void {
    const report = (): void => {
      const onProgress = this.options.onProgress;
      if (!onProgress || this.destroyed) return;
      // Nothing to report from a player nobody has started: the position is 0
      // and reporting it would clear a real one recorded on another device.
      if (!this.started) return;
      this.lastProgressAt = Date.now();
      onProgress(this.video.currentTime, this.video.duration);
    };

    // The OS scrubber rides on the same events but is not throttled with them:
    // it is two numbers handed to the system, it costs nothing, and it is the
    // one thing on the lock screen that looks broken the moment it lags.
    this.video.addEventListener("timeupdate", () => this.publishPosition());
    this.video.addEventListener("seeked", () => this.publishPosition());

    this.video.addEventListener("timeupdate", () => {
      if (Date.now() - this.lastProgressAt < PROGRESS_INTERVAL_MS) return;
      report();
    });
    for (const event of ["pause", "ended", "seeked"]) {
      this.video.addEventListener(event, report);
    }
    this.reportProgress = report;
  }

  /**
   * The control bar.
   *
   * Chromium hides Picture-in-Picture and playback speed behind the native
   * overflow ("...") menu, and iOS's native controls have no 10-second skip, no
   * speed picker short of a long-press, and vanish once the video is playing —
   * so both platforms need a bar of our own alongside the native scrubber.
   *
   * It is one design now, not two. The desktop used to get a left-packed row of
   * seven text buttons of seven different widths, which read as a debug panel
   * next to the phone's; the phone got symbols on a grid. The grid is the one
   * that was right, so it is what both get: a single surface, `1fr auto 1fr`,
   * with the transport in the middle cell so Play is centred on the *player*
   * rather than on whatever happens to sit beside it. Every control is the same
   * square, in the same colour, at the same spacing, except the one you reach
   * for most — Play, which is round, larger and in the accent colour.
   *
   * Under it, when the note has sections to go to, a second row of three named
   * links. They are text, not symbols, because there is no icon for "the
   * transcript" and a control that navigates somewhere should say where.
   *
   * Every control has a fixed size and no layout-affecting state change, so
   * pressing one never moves its neighbours or the note content around it.
   */
  private buildControls(): void {
    const bar = this.container.createDiv({ cls: "ytfree-controls" });

    const groups = {
      left: bar.createDiv({ cls: "ytfree-controls-group ytfree-controls-side" }),
      mid: bar.createDiv({ cls: "ytfree-controls-group ytfree-controls-transport" }),
      right: bar.createDiv({ cls: "ytfree-controls-group ytfree-controls-side" }),
    };
    const host = (side: "left" | "mid" | "right"): HTMLElement => groups[side];

    const button = (
      side: "left" | "mid" | "right",
      label: string,
      icon: string,
      title: string,
      onClick: () => void,
    ) => {
      const el = host(side).createEl("button", {
        cls: "ytfree-btn",
        attr: { title, "aria-label": title },
      });
      el.type = "button";
      this.paint(el, label, icon);
      el.addEventListener("click", (e) => {
        e.preventDefault();
        onClick();
      });
      return el;
    };

    const playBtn = button("mid", "Play", "play", "Play or pause", () => {
      if (!this.video.paused) {
        this.video.pause();
        return;
      }
      void this.withMedia(() => this.play());
    });
    playBtn.addClass("ytfree-btn-play");
    // Content swap only — the button keeps a fixed size, so nothing shifts.
    this.video.addEventListener("play", () => this.paint(playBtn, "Pause", "pause", "Pause"));
    this.video.addEventListener("pause", () => this.paint(playBtn, "Play", "play", "Play or pause"));

    const back = button("mid", "−10s", "rewind", "Back 10 seconds", () => {
      this.video.currentTime = Math.max(0, this.video.currentTime - 10);
    });
    back.addClass("ytfree-btn-back");
    const forward = button("mid", "+10s", "fast-forward", "Forward 10 seconds", () => {
      this.video.currentTime = this.video.currentTime + 10;
    });
    forward.addClass("ytfree-btn-forward");
    // A double chevron says "skip", not "skip how far". The numeral is a static
    // corner badge inside a fixed-size button, so it costs no layout.
    for (const el of [back, forward]) el.createSpan({ cls: "ytfree-btn-badge", text: "10" });

    const speed = host("left").createEl("select", {
      cls: "ytfree-speed",
      attr: { title: "Playback speed", "aria-label": "Playback speed" },
    });
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      speed.createEl("option", { text: `${rate}×`, value: String(rate) });
    }
    speed.value = "1";
    speed.addEventListener("change", () => {
      this.playbackRate = Number(speed.value);
      this.video.playbackRate = this.playbackRate;
    });

    // Smart Speed sits with the speed picker, because it is a speed control:
    // the select says how fast the talking goes, this says what happens to the
    // silence between it. Always built when the feature is wired up, whether or
    // not this video turns out to have a map — a control that appears once an
    // analysis finishes is a control that moves its neighbours.
    if (this.options.smartSpeed) {
      const smart = button("left", "Smart", "zap", "Smart Speed", () => {
        this.setSmartSpeed(!this.smartOn);
        this.options.smartSpeed?.onToggle?.(this.smartOn);
      });
      smart.addClass("ytfree-btn-smart");
      // The time saved lives *inside* the button, in the same absolutely
      // positioned strip the skip buttons put their "10" in. A readout beside
      // the toggle would be a second control's worth of width on a row that has
      // none to spare; a readout that costs no width can never reflow the row.
      this.smartBadge = smart.createSpan({ cls: "ytfree-btn-badge ytfree-smart-saved" });
      this.smartBtn = smart;
      this.smartOn = this.options.smartSpeed.enabled;
      this.paintSmart();
    }

    // Left, with the speed picker, rather than right with the size controls —
    // and not only for the sense of it. Three buttons on the right and one
    // control on the left is wider on that side than half a phone minus the
    // transport, and a side cell that cannot fit its contents is a transport
    // that is no longer in the middle. Two and two fits, on a 375pt screen too.
    button("left", "PiP", "picture-in-picture", "Picture-in-Picture", () => {
      void this.withMedia(() => this.togglePip());
    });

    button("right", "Fullscreen", "maximize", "Fullscreen", () => {
      void this.withMedia(() => this.toggleFullscreen());
    });

    if (this.onTimestamp) {
      button("right", "Timestamp", "clock", "Insert timestamp at cursor", () => {
        this.onTimestamp?.(Math.floor(this.video.currentTime));
      });
    }

    if (this.options.onToggleCollapse) {
      // Fixed size in CSS, because the content is the state: "Collapse" (or a
      // chevron pointing up) while the video is showing, the opposite while
      // it is not.
      this.collapseBtn = button("right", "Collapse", "chevrons-up", "Collapse the video", () =>
        this.options.onToggleCollapse?.(),
      );
      this.collapseBtn.addClass("ytfree-btn-collapse");
    }

    if (this.onDownload) {
      // The one button whose contents change to something that is not an icon:
      // a running download reads "12%" inside the same square. Fixed size, so
      // the row cannot reflow while it ticks.
      this.downloadBtn = button("right", "Download", "download", "Download this video for offline", () => {
        this.onDownload?.();
      });
      this.downloadBtn.addClass("ytfree-btn-download");
    }

    this.buildSectionLinks();
  }

  /**
   * Notes, Video Description, Video Transcript — where the note's own headings
   * are, one tap away.
   *
   * A phone note with a docked player and a transcript in it is thousands of
   * lines long, and the only way to the description was to scroll past the
   * notes. Text rather than symbols, equal widths, and the same surface as the
   * bar above them so the two rows read as one control.
   */
  private buildSectionLinks(): void {
    const jump = this.options.onJump;
    if (!jump) return;

    const row = this.container.createDiv({ cls: "ytfree-sections" });
    const links: Array<[SectionName, string]> = [
      ["notes", "Notes"],
      ["description", "Description"],
      ["transcript", "Transcript"],
    ];
    for (const [section, label] of links) {
      const el = row.createEl("button", {
        cls: "ytfree-section-link",
        text: label,
        attr: { title: `Go to ${label}`, "aria-label": `Go to ${label}` },
      });
      el.type = "button";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        jump(section);
      });
    }
  }

  /**
   * Fill a control with its symbol.
   *
   * The label fallback is not decoration. `setIcon` with a name this Obsidian
   * build does not know leaves the element empty, and an empty button is a
   * control nobody can use — so an icon that did not render becomes its word
   * instead, and the button grows to hold it rather than sitting there blank.
   */
  private paint(el: HTMLButtonElement, label: string, icon: string, title?: string): void {
    if (title) {
      el.setAttribute("title", title);
      el.setAttribute("aria-label", title);
    }
    const badge = el.querySelector(".ytfree-btn-badge");
    el.empty();
    el.removeClass("ytfree-btn-text");
    setIcon(el, icon);
    if (!el.firstElementChild) {
      el.setText(label);
      el.addClass("ytfree-btn-text");
    }
    if (badge) el.appendChild(badge);
  }

  // ----------------------------------------------------------- Smart Speed

  /**
   * Keep the pitch where it belongs, on both engines.
   *
   * `preservesPitch` is the standard; iOS Safari has only ever had the
   * `webkit`-prefixed one, and it is the platform where a 3× pause without it
   * is most obviously wrong. Re-applied after every source swap, because the
   * element resets it along with everything else on `load()`.
   */
  private preservePitch(): void {
    const el = this.video as HTMLVideoElement & { webkitPreservesPitch?: boolean };
    el.preservesPitch = true;
    el.webkitPreservesPitch = true;
  }

  /**
   * The engine runs on `requestAnimationFrame`, not on `timeupdate`.
   *
   * `timeupdate` fires about four times a second, and a quarter of a second at
   * 1× is a quarter of a second of pause played at speech rate on the way in
   * and a clipped syllable on the way out. A frame is 16 ms, which is under the
   * threshold where the rate change is audible as a seam. It only runs while
   * something is playing — a paused player costs nothing.
   */
  private trackSmartSpeed(): void {
    if (!this.options.smartSpeed) return;
    this.video.addEventListener("play", () => this.startSmartLoop());
    for (const event of ["pause", "ended"]) {
      this.video.addEventListener(event, () => this.stopSmartLoop());
    }

    // A hidden window gets no animation frames, so locking the phone or
    // switching apps freezes this engine wherever it happened to be. If that
    // was inside an instrumental, the 3× it had just applied would stay applied
    // for as long as the screen was off — audio still running, at chipmunk
    // speed, with nothing left awake to put it back. So hand the rate back
    // before the frames stop, and pick the loop up when the screen returns.
    this.onVisibility = () => {
      if (document.hidden) {
        this.stopSmartLoop();
        if (this.smartTouchedRate) this.applyRate(this.playbackRate);
      } else if (!this.video.paused && !this.destroyed) {
        this.startSmartLoop();
      }
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private startSmartLoop(): void {
    if (this.smartRaf !== null || this.destroyed) return;
    this.lastFrameAt = 0;
    const tick = (now: number): void => {
      if (this.destroyed) return;
      this.smartRaf = requestAnimationFrame(tick);
      this.smartFrame(now);
    };
    this.smartRaf = requestAnimationFrame(tick);
  }

  private stopSmartLoop(): void {
    if (this.smartRaf === null) return;
    cancelAnimationFrame(this.smartRaf);
    this.smartRaf = null;
  }

  /**
   * One frame: decide the rate, apply it if it changed, and count what the
   * change bought.
   *
   * The early return is the acceptance criterion "toggle off → the engine never
   * touches `playbackRate`", spelled out in the one place it could be violated.
   */
  private smartFrame(now: number): void {
    if (!this.smartOn || this.activeWindows.length === 0) return;
    // A seek already in flight is a decision in progress — the reader's, or the
    // one this made last frame. Landing a second one on top of it is how a jump
    // turns into a stutter.
    if (this.video.seeking) {
      this.lastFrameAt = now;
      return;
    }

    const base = this.playbackRate;
    const at = this.video.currentTime;
    const move = moveFor(
      at,
      this.activeWindows,
      base,
      this.options.smartSpeed?.silenceRate ?? base,
    );

    if (move.kind === "skip" && this.canSeekTo(move.to)) {
      // The rate goes back first: a seek out of a window the player was already
      // speeding through must not land at 3× on the far side of it.
      this.applyRate(base);
      this.video.currentTime = move.to;
      this.lastFrameAt = now;
      const saved = secondsSkipped(move.to - at, base);
      if (saved > 0) {
        this.savedSeconds += saved;
        this.paintSavedTime();
      }
      return;
    }

    // Either an instrumental, or a skip this player cannot honour — an unbuffered
    // target, or a window too short to be worth a seek. Both play fast, which is
    // what every window did before 017.
    const rate = move.rate;
    this.applyRate(rate);

    const elapsed = this.lastFrameAt ? (now - this.lastFrameAt) / 1000 : 0;
    this.lastFrameAt = now;
    if (elapsed > 0 && elapsed <= MAX_FRAME_SECONDS) {
      const saved = secondsSaved(elapsed, base, rate);
      if (saved > 0) {
        this.savedSeconds += saved;
        this.paintSavedTime();
      }
    }
  }

  private applyRate(rate: number): void {
    if (Math.abs(this.video.playbackRate - rate) <= 0.001) return;
    this.video.playbackRate = rate;
    this.smartTouchedRate = true;
  }

  /**
   * Is there data at `target`, or would jumping there stall?
   *
   * The whole point of a skip is that it is inaudible, and a seek past the end
   * of the buffer is a spinner — worse than the pause it removed. `buffered` is
   * the only thing that answers this cheaply, and it is answered honestly for a
   * direct stream, a local file and an HLS media source alike.
   *
   * Half a second of headroom past the target, so a jump does not land on the
   * very edge of what has arrived and stall on the next frame instead.
   */
  private canSeekTo(target: number): boolean {
    const ranges = this.video.buffered;
    for (let i = 0; i < ranges.length; i++) {
      if (target >= ranges.start(i) && target + 0.5 <= ranges.end(i)) return true;
      // The tail of the video is a legitimate landing place even with less than
      // half a second of it left.
      if (target >= ranges.start(i) && ranges.end(i) >= this.video.duration - 0.05) {
        return target <= ranges.end(i);
      }
    }
    return false;
  }

  /**
   * Hand the player a silence map. Safe to call repeatedly — the ffmpeg
   * producer calls it every time a batch of windows lands, mid-playback, and
   * replacing the windows under a running loop is a one-frame change of mind.
   */
  setSilenceWindows(windows: PlaybackWindow[], source: SilenceSource): void {
    if (this.destroyed) return;
    this.silenceWindows = windows;
    this.silenceSource = source;
    this.smartReason = null;
    this.refreshWindows();
  }

  /**
   * There is no map for this video and there is not going to be one — no
   * captions, and no ffmpeg to fall back on. The toggle dims and says why; it
   * does not disappear, and it does not change size.
   */
  setSmartSpeedUnavailable(reason: string): void {
    if (this.destroyed) return;
    this.silenceWindows = [];
    this.activeWindows = [];
    this.silenceSource = null;
    this.smartReason = reason;
    this.paintSmart();
  }

  /** The user moved the minimum-silence slider. No refetch — just re-filter. */
  setSilenceSettings(minGap: number, silenceRate: number): void {
    if (!this.options.smartSpeed) return;
    this.options.smartSpeed.minGap = minGap;
    this.options.smartSpeed.silenceRate = silenceRate;
    this.refreshWindows();
  }

  private refreshWindows(): void {
    const minGap = this.options.smartSpeed?.minGap ?? 0;
    this.activeWindows = compressibleWindows(this.silenceWindows, minGap);
    this.paintSmart();
  }

  /** Flip the engine. Turning it off puts the rate back where the user had it. */
  setSmartSpeed(on: boolean): void {
    if (this.smartOn === on) return;
    this.smartOn = on;
    if (!on && this.smartTouchedRate) {
      // Undoing our own change, not touching a rate we never moved.
      this.video.playbackRate = this.playbackRate;
    }
    this.paintSmart();
  }

  get isSmartSpeedOn(): boolean {
    return this.smartOn;
  }

  /**
   * The toggle's three states, all inside a fixed square: on, off, and dimmed
   * because this video has nothing to compress. Only the colour, the tooltip
   * and the icon change — never the box.
   */
  private paintSmart(): void {
    const el = this.smartBtn;
    if (!el) return;

    const usable = this.activeWindows.length > 0;
    el.toggleClass("is-active", this.smartOn && usable);
    el.disabled = !usable && this.smartReason !== null;

    const source = this.silenceSource === "ffmpeg" ? "measured audio" : "caption timing";
    // Two sentences because there are now two behaviours, and which one you get
    // is the thing a reader wonders about when a video jumps.
    const speeds = this.activeWindows.some((window) => window.action === "speed");
    const title = !usable
      ? this.smartReason
        ? `Smart Speed unavailable — ${this.smartReason}`
        : "Smart Speed — looking for pauses…"
      : this.smartOn
        ? `Smart Speed on (${source}) — silence is skipped${
            speeds ? `, non-speech audio plays at ${this.options.smartSpeed?.silenceRate ?? 3}×` : ""
          }`
        : "Smart Speed off";

    el.setAttribute("title", title);
    el.setAttribute("aria-label", title);
    el.setAttribute("aria-pressed", String(this.smartOn && usable));
    this.paintSavedTime();
  }

  /**
   * `−1:20` under the icon, in the badge strip. Blank below a second, because a
   * readout that starts at "−0:00" reads as broken rather than as new.
   */
  private paintSavedTime(): void {
    if (!this.smartBadge) return;
    const text = this.savedSeconds >= 1 ? `−${formatTimestamp(this.savedSeconds)}` : "";
    if (this.smartBadge.textContent !== text) this.smartBadge.setText(text);
  }

  /**
   * Run something that needs actual media, resolving the stream first if it has
   * not been fetched yet.
   *
   * Mobile mounts the player without resolving anything, so before the poster
   * was tapped every control acting on the `<video>` was acting on an empty
   * element: Play did nothing, PiP had no picture. They all come through here
   * now, so the first tap on any of them is the tap that starts the video.
   *
   * `primeForGesture` has to happen synchronously, inside the tap, or iOS will
   * refuse to play once the resolve returns — and only when there is nothing
   * loaded, since `load()` on a playing element would restart it.
   */
  private async withMedia(run: () => void | Promise<void>): Promise<void> {
    const ensure = this.options.ensureLoaded;
    if (ensure && this.video.readyState === 0) {
      this.primeForGesture();
      this.loading ??= ensure().finally(() => {
        this.loading = null;
      });
      try {
        await this.loading;
      } catch {
        return; // The failure is already on screen as the fallback panel.
      }
    }
    await run();
  }

  /** Reflect collapsed state in the button that toggles it. */
  setCollapsed(collapsed: boolean): void {
    if (!this.collapseBtn) return;
    this.paint(
      this.collapseBtn,
      collapsed ? "Show video" : "Collapse",
      collapsed ? "chevrons-down" : "chevrons-up",
      collapsed ? "Show the video again" : "Collapse the video",
    );
  }

  /**
   * Progress feedback on the Download button itself.
   *
   * Running, it is the percentage in place of the icon — inside the same square,
   * at a size "100%" fits in. Done, it is a tick: the button has nothing left to
   * do and a tick says so without needing to be read.
   */
  setDownloadState(state: "idle" | "running" | "done", percent?: number): void {
    const el = this.downloadBtn;
    if (!el) return;
    el.toggleClass("is-progress", state === "running");
    if (state === "running") {
      el.empty();
      el.setText(percent === undefined ? "…" : `${Math.round(percent)}%`);
      el.setAttribute("title", "Downloading…");
      el.setAttribute("aria-label", "Downloading…");
      el.disabled = true;
    } else if (state === "done") {
      this.paint(el, "Downloaded", "check", "Downloaded for offline");
      el.disabled = true;
    } else {
      this.paint(el, "Download", "download", "Download this video for offline");
      el.disabled = false;
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
    // Where this video was left, if it was left anywhere. `attach` seeks once
    // the media reports metadata, so this costs nothing when it is 0 and does
    // not race a timestamp link tapped a moment later — that seek is registered
    // afterwards and therefore lands last.
    this.attach(stream, this.resumeSeconds(), false);
    if (upgradeToHighQuality) void this.upgrade();
  }

  /** The remembered position, guarded against a stored value that is not one. */
  private resumeSeconds(): number {
    const seconds = this.options.resumeAt?.() ?? 0;
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
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
    // Same resume as a stream: the position is the video's, not the source's.
    const resumeAt = this.resumeSeconds();
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        if (resumeAt > 0) this.video.currentTime = resumeAt;
        this.preservePitch();
      },
      { once: true },
    );
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
        this.preservePitch();
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
      this.preservePitch();
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
   * Stop playback where it is, on the user's say-so.
   *
   * Deliberately not `pauseForTyping`: this pause is the user's, so the idle
   * timer must never resume it.
   */
  pause(): void {
    if (this.destroyed) return;
    this.pausedByTyping = false;
    this.video.pause();
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

  /**
   * Is there a real position to stamp?
   *
   * `started` alone was too strict: a note reopened at its resume position sits
   * paused at, say, 14:20 having fired no `play` event this session, so the
   * first note you typed got no timestamp at all. A non-zero `currentTime` is
   * the same fact by another route — the video is somewhere — and 0 still means
   * "untouched", which is the one case the guard exists for.
   */
  get hasPlayed(): boolean {
    return this.started || this.video.currentTime > 0;
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
    // Before the flag, or the report refuses itself: closing the note is the
    // most common way a session ends, and it is the position that matters most.
    this.reportProgress?.();
    this.destroyed = true;
    this.stopSmartLoop();
    if (this.onVisibility) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onVisibility = null;
    }
    this.clearNowPlaying();
    this.teardownHls();
    this.video.removeAttribute("src");
    this.video.load();
    this.container.empty();
  }
}
