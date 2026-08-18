import Hls from "hls.js";
import { setIcon } from "obsidian";
import { formatTimestamp } from "./format.ts";
import { SHARE_ICON } from "./icon.ts";
import { anchorVisible, panelPlacement } from "./panel.ts";
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
   * Somewhere to say what the player just did, when the reader has asked for it
   * (Settings → Troubleshooting). Absent, nothing is logged — this exists for
   * the fullscreen and keyboard paths (038, 041), which fail by doing nothing
   * on a device with no console attached.
   */
  debug?: (message: string, extra?: unknown) => void;
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
  /**
   * Open the plugin's own settings tab. Absent, the row is not drawn —
   * reaching Obsidian's settings is an app API, not a player one. It lives at
   * the foot of the pop-out rather than on the bar: a screen you visit twice a
   * year does not deserve a permanent thumb-sized target next to Play.
   */
  onOpenSettings?: () => void;
  /**
   * The pinned player — the copy that rides at the top of the note. A global
   * setting rather than a per-video one, which is why it is on the bar and not
   * in the pop-out: everything in there is "this video only".
   */
  pin?: PinOptions;
  /**
   * Share this video. One button on the bar, not two — the choice between a
   * plain link and a link at this moment is made *after* pressing it, in a menu
   * the host draws. The player supplies the anchor to draw it against and the
   * position to offer, and knows nothing about clipboards or share sheets.
   */
  share?: (anchor: HTMLElement, seconds: number) => void;
  /**
   * Jump the note to the transcript paragraph covering a moment in the video.
   *
   * The second row's "Transcript" link goes to the top of the section, which is
   * the wrong end of a two-hour lecture; the peaks jump to their own moment,
   * which only helps at the five moments the crowd happened to replay. This is
   * the same jump for the moment you are actually at, so it takes the position
   * as an argument — the host reads the note, the player knows the second.
   */
  onJumpToMoment?: (seconds: number) => void;
  /** The pop-out of per-video controls. Absent, there is no pop-out button. */
  quick?: QuickPanelOptions;
  /**
   * The pop-out is positioned against the viewport rather than against the
   * control bar. Phones only — see `src/panel.ts` for why the bar's own
   * coordinate space cannot hold it inside the Preview sheet at any height.
   */
  panelAnchored?: boolean;
  /**
   * Dragging left and right across the picture seeks. Mobile only: on a phone
   * a horizontal swipe belongs to the host app, and over a video it should not.
   */
  dragSeek?: boolean;
  /**
   * How this video was left the last time a player was built for it, and where
   * to report changes to. Absent, the player starts at 1× and the element's own
   * volume, which is what a first sight of a video should do.
   */
  session?: SessionOptions;
}

/**
 * The settings that belong to the video rather than to this instance of the
 * player.
 *
 * A player is destroyed and rebuilt for reasons that have nothing to do with
 * the video — the pin toggled, the note reopened, the view's DOM replaced — and
 * every one of those used to put the speed back to 1× and the volume back to
 * full. The host holds these across the rebuild; the player reads them once at
 * construction and reports every change.
 */
export interface SessionOptions {
  /** Playback speed, as the picker's own values: 0.5 to 2. */
  rate?: number;
  volume?: number;
  muted?: boolean;
  onRate?: (rate: number) => void;
  onVolume?: (volume: number, muted: boolean) => void;
}

export interface PinOptions {
  /** Whether the pinned player is on right now. Paints the button's state. */
  pinned: boolean;
  onToggle: () => void;
}

/**
 * The controls that belong to *this* video rather than to the plugin.
 *
 * Everything here is a per-player override that lasts as long as the note is
 * open: changing it must never write a global setting, because "no music
 * skipping on this lecture" and "no music skipping ever" are different
 * decisions and only one of them was made.
 */
export interface QuickPanelOptions {
  /**
   * The player's height, in vh, and where to put a new one. Absent — a fenced
   * block, which sizes itself — and the size control is not drawn.
   */
  heightVh?: number;
  onHeight?: (vh: number) => void;
  /**
   * Whether non-speech audio is skipped along with the silence. Decided when
   * the windows are combined, so the player cannot apply it alone: it hands the
   * answer back and is given a fresh map.
   */
  skipNonSpeech?: boolean;
  onSkipNonSpeech?: (value: boolean) => void;
  /**
   * Whether typing in the note pauses this video. The global default is a
   * setting; this is the answer for the note in front of you, and like
   * everything else in here it dies with it.
   */
  pauseWhileTyping?: boolean;
  onPauseWhileTyping?: (value: boolean) => void;
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
 * How much video a full-width drag across the picture covers.
 *
 * Not the whole video: a proportional scrub is unusable on an hour-long lecture
 * — a thumb's width is two minutes — and the thing you actually want on a phone
 * is "back a bit, forward a bit". Ninety seconds across the picture makes a
 * single point of movement about a quarter of a second.
 */
const DRAG_SEEK_SECONDS = 90;

/** How far a finger has to travel before a touch is a seek rather than a tap. */
const DRAG_SEEK_THRESHOLD_PX = 12;

/**
 * The bottom strip of the picture belongs to the platform's own controls, and
 * its scrubber is a horizontal drag too. Touches starting in here are left
 * alone so the native bar still works.
 */
const NATIVE_CONTROLS_BAND_PX = 56;

/**
 * A frame gap longer than this is not playback, it is a window that was hidden
 * or a laptop that was asleep. Counted as zero rather than as two minutes of
 * saved listening.
 */
const MAX_FRAME_SECONDS = 0.5;

/**
 * How long the native control panel stays blacked out after a resume nobody
 * pressed — see `hushNativeControls`.
 *
 * Comfortably past both engines' own auto-hide (about three seconds in WebKit,
 * three in Chromium), so the panel that was hidden has decided to go on its own
 * before the blackout lifts. Lift it earlier and the controls would appear for
 * the remainder of their timer, which is the whole thing being avoided.
 */
const CONTROLS_HUSH_MS = 6000;

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
  /**
   * True only while playback is paused *by the system* — the phone locked, the
   * app was switched away from, the home screen appeared. Set from the `pause`
   * event rather than from a call, because nothing on this side asked for it.
   */
  private pausedWhileHidden = false;
  /**
   * While `Date.now()` is under this, a `play` we did not ask for is WebKit
   * undoing its own background pause, and gets undone in turn. Armed on the way
   * back to visible and cleared by the first play either way, so a tap on the
   * native controls a second later is the reader's and is left alone.
   */
  private resumeGuardUntil = 0;
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
  /** The purple line along the bottom of the picture, and the part that fills. */
  private progressBar: HTMLElement | null = null;
  private progressFill: HTMLElement | null = null;
  /** The Play/Pause button, repainted from one place — see `paintPlay`. */
  private playBtn: HTMLButtonElement | null = null;
  /**
   * Play was pressed before there was anything to play.
   *
   * The button toggles anyway — the reader asked, and an unresponsive control is
   * worse than a slow one — but the video is started by whatever finishes
   * loading rather than by the tap, so the state on the button is never a lie
   * about what the player is doing.
   */
  private pendingPlay = false;
  /**
   * The timer that lifts the native-controls blackout — see `hushNativeControls`.
   * Non-null only while a blackout is in force.
   */
  private hushTimer: number | null = null;
  // --- Drag-to-seek. Null between gestures.
  private drag: { id: number; x: number; y: number; from: number; to: number; live: boolean } | null =
    null;
  /** The time a drag is heading for, painted instead of `currentTime`. */
  private dragReadout: HTMLElement | null = null;
  // --- The per-video pop-out.
  private panel: HTMLElement | null = null;
  private panelBtn: HTMLButtonElement | null = null;
  private panelOpen = false;
  /**
   * The tap-catcher behind the pop-out. Built with the panel and never inserted
   * or removed on a click — only its `visibility` changes, so a menu opening
   * cannot move anything, and a tap meant for "close the menu" cannot fall
   * through to the modal underneath and close that too.
   */
  private panelScrim: HTMLElement | null = null;
  /**
   * Kept so an open anchored panel can be re-placed while the surface behind it
   * scrolls, and taken off again the moment it closes. See `placePanel`.
   */
  private onPanelReflow: (() => void) | null = null;
  private smartSwitch: HTMLButtonElement | null = null;
  private pinBtn: HTMLButtonElement | null = null;
  /** The plugin's own fullscreen — see `setImmersive`. */
  private immersive = false;
  /** Kept so `destroy` can take them off `document`, which outlives this player. */
  private onDocPointer: ((event: Event) => void) | null = null;
  private onDocKey: ((event: KeyboardEvent) => void) | null = null;
  /** The lazy resolve, once asked for. Every later caller awaits the same one. */
  private loading: Promise<void> | null = null;
  /** Throttle for the position reports — see `trackProgress`. */
  private lastProgressAt = 0;
  private reportProgress: (() => void) | null = null;

  // --- Smart Speed. All inert unless `options.smartSpeed` was supplied.
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
  /** Same, for the background-pause guard — it is registered unconditionally. */
  private onBackgroundVisibility: (() => void) | null = null;

  constructor(
    private container: HTMLElement,
    private provider: StreamProvider,
    private onStatus: (message: string | null) => void,
    private onDownload?: () => void,
    private options: PlayerOptions = {},
  ) {
    // The picture and the line under it share a box, so the line can sit on the
    // video's bottom edge without being in the flow — a 3px element in the
    // column would push the note text down by 3px, and nothing here is allowed
    // to move the note. Mobile already has such a box (the fixed-aspect media
    // host); the desktop gets a bare one that is exactly the video's size.
    const stage = options.mediaHost ?? container.createDiv({ cls: "ytfree-stage" });
    this.video = stage.createEl("video", {
      cls: "ytfree-video",
      attr: { controls: "", playsinline: "", preload: "metadata" },
    });
    this.buildProgressBar(stage);
    if (options.dragSeek) this.bindDragSeek(stage);

    // Before anything can set a rate above 1: without this a 3× pause is a
    // chipmunk, and Chromium and WebKit spell the property differently.
    this.preservePitch();

    // How loud this video was left, before anything can be heard at the wrong
    // volume. Both are read here rather than at `attach`, which already carries
    // the element's own values across a source swap — this is the case where
    // there is no element to carry them from, because the last one was
    // destroyed with the player it belonged to.
    const session = options.session;
    if (session?.volume !== undefined && Number.isFinite(session.volume)) {
      this.video.volume = Math.min(1, Math.max(0, session.volume));
    }
    if (session?.muted !== undefined) this.video.muted = session.muted;
    if (session?.onVolume) {
      this.video.addEventListener("volumechange", () =>
        session.onVolume?.(this.video.volume, this.video.muted),
      );
    }

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

    // The two ways a blackout ends before its timer: a hand on the picture,
    // which is a request for the controls, and a pause, which is a state the
    // native bar is supposed to be visible in. See `hushNativeControls`.
    for (const event of ["pointerdown", "pause"]) {
      this.video.addEventListener(event, () => this.unhushNativeControls());
    }

    this.trackBackgroundPause();
    this.trackProgress();
    this.trackNowPlaying();
  }

  /**
   * How far along you are, as a line across the foot of the picture.
   *
   * The native scrubber answers this too, but it is hidden the moment playback
   * starts on iOS and it is the thing you have to reach for on a phone. A line
   * you never touch says the one number you keep wanting — and because it lives
   * inside the media box rather than in the column, it costs the note no height
   * whether it is drawn or not.
   *
   * Nothing hides it in fullscreen because nothing has to: fullscreen is
   * requested on the `<video>` element itself, and a sibling of a fullscreen
   * element is not rendered. The rule in `styles.css` is a belt on top of that,
   * for the day something fullscreens the wrapper instead.
   */
  private buildProgressBar(stage: HTMLElement): void {
    const bar = stage.createDiv({ cls: "ytfree-progress" });
    this.progressFill = bar.createDiv({ cls: "ytfree-progress-fill" });
    this.progressBar = bar;

    const paint = (): void => this.paintProgress();
    // `seeked` matters as much as `timeupdate` here: a Smart Speed jump moves
    // the position without playing through it, and a line that only advanced
    // with playback would lag by the length of every skip.
    for (const event of ["timeupdate", "seeked", "loadedmetadata", "durationchange", "emptied"]) {
      this.video.addEventListener(event, paint);
    }
    paint();
  }

  /** `scaleX`, never `width`: a transform is composited and reflows nothing. */
  private paintProgress(): void {
    const fill = this.progressFill;
    if (!fill || !this.progressBar) return;
    const duration = this.video.duration;
    const live = Number.isFinite(duration) && duration > 0;
    // Hidden until there is a real duration, so an unresolved player does not
    // show a track over its poster with nothing in it.
    this.progressBar.toggleClass("is-live", live);
    // A drag in progress is the position the reader is choosing, not the one
    // the video is still playing: the line is the preview of where they will
    // land, which is the only feedback a paused frame can give them.
    const at = this.drag?.live ? this.drag.to : this.video.currentTime;
    const fraction = live ? Math.min(1, Math.max(0, at / duration)) : 0;
    fill.style.transform = `scaleX(${fraction.toFixed(5)})`;
  }

  /**
   * Left and right across the picture is seeking, and nothing else.
   *
   * On a phone this gesture belonged to Obsidian — a horizontal swipe over the
   * video opened the sidebar, which is never what a video means. The host is
   * told to keep out with `data-ignore-swipe` on the wrapper (Obsidian walks up
   * from the touch target and abandons the gesture on the first element that
   * has it); this is the other half, which puts the movement to use.
   *
   * The seek is committed on release, not while the finger moves: one seek
   * instead of sixty, which on an HLS stream is the difference between a scrub
   * and a stall. The purple line and the readout follow the finger, so the
   * feedback is immediate even though the video does not move until you let go.
   */
  private bindDragSeek(stage: HTMLElement): void {
    this.dragReadout = stage.createDiv({ cls: "ytfree-seek" });

    const duration = (): number => {
      const value = this.video.duration;
      return Number.isFinite(value) && value > 0 ? value : 0;
    };

    stage.addEventListener(
      "touchstart",
      (event) => {
        // A second finger is a pinch or the platform's own gesture. Whatever it
        // is, it is not this one, so an in-flight drag is abandoned rather than
        // fought over.
        if (event.touches.length !== 1) {
          this.endDrag(false);
          return;
        }
        if (duration() === 0) return; // nothing resolved yet: the poster's tap
        const touch = event.touches[0];
        // The platform's own control bar lives along the bottom edge and its
        // scrubber is a horizontal drag too. Leave that strip alone.
        const box = stage.getBoundingClientRect();
        if (touch.clientY > box.bottom - NATIVE_CONTROLS_BAND_PX) return;
        this.drag = {
          id: touch.identifier,
          x: touch.clientX,
          y: touch.clientY,
          from: this.video.currentTime,
          to: this.video.currentTime,
          live: false,
        };
      },
      { passive: true },
    );

    stage.addEventListener(
      "touchmove",
      (event) => {
        const drag = this.drag;
        if (!drag) return;
        const touch = Array.from(event.touches).find((t) => t.identifier === drag.id);
        if (!touch) return;

        const dx = touch.clientX - drag.x;
        const dy = touch.clientY - drag.y;
        if (!drag.live) {
          if (Math.abs(dx) < DRAG_SEEK_THRESHOLD_PX) return;
          // Mostly vertical: the reader is scrolling the note past the player,
          // and taking that away would trap them at the top of it.
          if (Math.abs(dx) <= Math.abs(dy)) {
            this.drag = null;
            return;
          }
          drag.live = true;
        }

        // Once it is a seek it is only a seek: no scrolling, and no native
        // scrubber picking the same movement up underneath us.
        event.preventDefault();
        const width = stage.clientWidth || 1;
        const total = duration();
        drag.to = Math.min(total, Math.max(0, drag.from + (dx / width) * DRAG_SEEK_SECONDS));
        this.paintProgress();
        this.paintSeekReadout();
      },
      { passive: false },
    );

    for (const event of ["touchend", "touchcancel"]) {
      stage.addEventListener(event, (e) => {
        const drag = this.drag;
        if (!drag) return;
        const changed = (e as TouchEvent).changedTouches;
        if (changed && !Array.from(changed).some((t) => t.identifier === drag.id)) return;
        this.endDrag(event === "touchend");
      });
    }
  }

  /** Land the drag where the finger left it, or throw it away. */
  private endDrag(commit: boolean): void {
    const drag = this.drag;
    this.drag = null;
    if (this.dragReadout) this.dragReadout.removeClass("is-visible");
    if (!drag) return;
    if (commit && drag.live) this.video.currentTime = drag.to;
    this.paintProgress();
  }

  /** `12:40  +1:05` over the picture, while the finger is down. */
  private paintSeekReadout(): void {
    const el = this.dragReadout;
    const drag = this.drag;
    if (!el || !drag) return;
    const delta = Math.round(drag.to - drag.from);
    const sign = delta < 0 ? "−" : "+";
    el.setText(`${formatTimestamp(drag.to)}  ${sign}${formatTimestamp(Math.abs(delta))}`);
    el.addClass("is-visible");
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

    // Named rather than positional. They used to be told apart by `:first-child`
    // and `:last-child`, and the pop-out — built into this same bar, and last in
    // it — quietly took `:last-child` away from the right-hand group: it stopped
    // being right-aligned, so it sat one grid gap from the transport with all
    // the air stranded on the far side. A class cannot be stolen by a sibling.
    const groups = {
      left: bar.createDiv({ cls: "ytfree-controls-group ytfree-controls-side ytfree-controls-left" }),
      mid: bar.createDiv({ cls: "ytfree-controls-group ytfree-controls-transport" }),
      right: bar.createDiv({
        cls: "ytfree-controls-group ytfree-controls-side ytfree-controls-right",
      }),
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
      // Pressed while it is still starting: the reader has changed their mind,
      // and the load carries on without playing at the end of it.
      if (this.pendingPlay) {
        this.setPendingPlay(false);
        return;
      }
      if (!this.video.paused) {
        this.video.pause();
        return;
      }
      void this.withMedia(() => this.play());
    });
    playBtn.addClass("ytfree-btn-play");
    this.playBtn = playBtn;
    // Content swap only — the button keeps a fixed size, so nothing shifts.
    for (const event of ["play", "pause", "ended"]) {
      this.video.addEventListener(event, () => this.paintPlay());
    }
    this.paintPlay();

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

    // Left is how the picture plays and where it plays: the speed picker, then
    // the two ways out of the note — Picture-in-Picture and Fullscreen, which
    // are the same decision at two sizes and belong beside each other.
    const speed = host("left").createEl("select", {
      cls: "ytfree-speed",
      attr: { title: "Playback speed", "aria-label": "Playback speed" },
    });
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      speed.createEl("option", { text: `${rate}×`, value: String(rate) });
    }
    // Where this video was left, not 1× — see `SessionOptions`. The picker only
    // offers these seven values, so a stored rate that is not one of them (an
    // older record, a hand-edited file) would leave the `<select>` blank; it is
    // taken only when it matches something on the list.
    const stored = this.options.session?.rate;
    if (stored !== undefined && speed.querySelector(`option[value="${stored}"]`)) {
      this.playbackRate = stored;
      this.video.playbackRate = stored;
      speed.value = String(stored);
    } else {
      speed.value = "1";
    }
    speed.addEventListener("change", () => {
      this.playbackRate = Number(speed.value);
      this.video.playbackRate = this.playbackRate;
      this.options.session?.onRate?.(this.playbackRate);
    });

    // Smart Speed is no longer a button here. It was the ninth control on a
    // row that had run out of width, and it is a setting you change once a
    // video rather than a transport you reach for — so it lives in the pop-out,
    // and the pop-out's own icon turns purple while it is on. One glance still
    // answers "is this thing speeding through my silence", which was the only
    // job the button on the bar was doing.
    if (this.options.smartSpeed) this.smartOn = this.options.smartSpeed.enabled;

    button("left", "PiP", "picture-in-picture", "Picture-in-Picture", () => {
      void this.withMedia(() => this.togglePip());
    });

    button("left", "Fullscreen", "maximize", "Fullscreen", () => {
      this.fullscreenPressed();
    });

    // Right is what this player does to the *note*: keep a copy of it, pin it,
    // fold it away — and the pop-out, last, because an overflow menu belongs at
    // the end of the run.
    //
    // No Timestamp button. Stamps arrive by typing (flow capture) or through
    // the command, on both platforms now: reaching for a button means taking
    // your hands off the note you were writing, which is the one thing the
    // stamp is supposed to save you.
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

    if (this.options.share) {
      // One button, and the fork lives in the menu it opens. Two buttons on the
      // bar would be two thumb-sized targets for one decision, and the second
      // of them ("share at 12:04") would be a control whose meaning changes
      // every second it is not pressed.
      const shareBtn = button("right", "Share", SHARE_ICON, "Share this video", () => {
        this.options.share?.(shareBtn, this.video.currentTime);
      });
      shareBtn.addClass("ytfree-btn-share");
    }

    if (this.options.pin) {
      // A pin, on the bar rather than in the pop-out, because it is the one
      // decision here that is not about this video: it turns the pinned player
      // on for every note that has a video in it. It was reachable only from
      // the command palette, which on a phone is three taps and a search.
      this.pinBtn = button("right", "Pin", "pin", "Pinned player", () => {
        // Deferred: turning the pin off unmounts this very player, and tearing
        // down the element whose click is still being dispatched is how you get
        // an event handler running against a detached tree.
        window.setTimeout(() => this.options.pin?.onToggle(), 0);
      });
      this.pinBtn.addClass("ytfree-btn-pin");
      this.paintPin(this.options.pin.pinned);
    }

    if (this.options.quick) {
      // The pop-out and the button that opens it. Both are built now, closed —
      // a panel that is created on the click that opens it is a panel that
      // cannot be positioned before it is seen, and this one has to open
      // upwards over the video without moving anything.
      this.panelBtn = button("right", "Options", "sliders-horizontal", "This video's settings", () =>
        this.togglePanel(),
      );
      this.panelBtn.addClass("ytfree-btn-panel");
      this.panelBtn.setAttribute("aria-expanded", "false");
      this.buildQuickPanel(bar, this.options.quick);
      this.paintSmart();
    }

    this.buildSectionLinks();
  }

  /**
   * The Play button's three states: playing, stopped, and starting.
   *
   * One place, because the button used to be painted by the `<video>`'s own
   * events alone — and an element with no source at all answers `paused` with
   * *false* after a refused `play()`, so it read "Pause" while nothing was
   * playing and nothing ever would. The button now says what the player is
   * doing, which during a resolve is "starting", not "playing".
   */
  private paintPlay(): void {
    const el = this.playBtn;
    if (!el) return;
    el.toggleClass("is-waiting", this.pendingPlay);
    if (this.pendingPlay) {
      this.paint(el, "Pause", "pause", "Starting… tap again to cancel");
      return;
    }
    if (this.isPlaying) this.paint(el, "Pause", "pause", "Pause");
    else this.paint(el, "Play", "play", "Play or pause");
  }

  private setPendingPlay(pending: boolean): void {
    if (this.pendingPlay === pending) return;
    this.pendingPlay = pending;
    this.paintPlay();
  }

  /**
   * Forget a Play that was asked for before the media existed.
   *
   * Called when the load it was waiting on fails: without this the button would
   * sit at "starting" for as long as the note stayed open, which is the same
   * lie in slower motion.
   */
  cancelPendingPlay(): void {
    this.setPendingPlay(false);
  }

  /**
   * Is there a source for `play()` to act on?
   *
   * The bug this answers: `play()` on an element with no source does not throw
   * and does not fire `pause` — it sets `paused` to false, rejects its promise,
   * and leaves the element in a state that a later `load()` does not reset,
   * because the reset step is skipped while `readyState` is HAVE_NOTHING. The
   * video then never starts, and the next tap only pauses the thing that was
   * never playing.
   */
  private get hasSource(): boolean {
    return this.hls !== null || this.video.readyState > 0 || this.video.currentSrc !== "";
  }

  /**
   * The pinned player was switched somewhere else — the command palette, or
   * another note's copy of this bar. A player that outlives the switch has to
   * be told, or its pin says the opposite of what is true.
   */
  setPinned(pinned: boolean): void {
    if (this.destroyed || !this.options.pin) return;
    this.options.pin.pinned = pinned;
    this.paintPin(pinned);
  }

  /** The pin's two states, in one box: colour and wording, never size. */
  private paintPin(pinned: boolean): void {
    const el = this.pinBtn;
    if (!el) return;
    el.toggleClass("is-active", pinned);
    const title = pinned
      ? "Pinned player on — tap to unpin"
      : "Pinned player off — tap to pin this video to the top of the note";
    el.setAttribute("title", title);
    el.setAttribute("aria-label", title);
    el.setAttribute("aria-pressed", String(pinned));
  }

  /**
   * Notes, Video Description, Video Transcript, This moment — where the note's
   * own headings are, one tap away.
   *
   * A phone note with a docked player and a transcript in it is thousands of
   * lines long, and the only way to the description was to scroll past the
   * notes. Text rather than symbols, equal widths, and the same surface as the
   * bar above them so the two rows read as one control.
   *
   * "This moment" is here rather than up among the icons for two reasons: it
   * navigates the *note*, which is what this row is for and what none of the
   * icons above do, and the right-hand icon group on a phone is already four
   * 40pt targets in half a screen — a fifth would not fit without shrinking the
   * things a thumb reaches for while a video plays.
   */
  private buildSectionLinks(): void {
    const jump = this.options.onJump;
    const moment = this.options.onJumpToMoment;
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

    if (!moment) return;
    row.addClass("ytfree-sections-four");
    const title = "Jump to this moment in the transcript";
    const here = row.createEl("button", {
      cls: "ytfree-section-link ytfree-section-moment",
      text: "This moment",
      attr: { title, "aria-label": title },
    });
    here.type = "button";
    here.addEventListener("click", (e) => {
      e.preventDefault();
      // Read at the click, not captured: the whole point is where the video is
      // now, and "now" is a different answer every time this is pressed.
      moment(this.video.currentTime);
    });
  }

  /**
   * The pop-out: the dials you change *for this video*, where you are watching
   * it, instead of in a settings screen two taps and a context switch away.
   *
   * Nothing in here writes a setting. "No music skipping on this lecture" and
   * "no music skipping ever" are different decisions, and the player is the
   * wrong place to make the second one — the Settings button beside it is the
   * right place, which is why both exist.
   *
   * It is built at construction and hidden with `visibility`, not created on
   * the click and not `display: none`: it is absolutely positioned out of the
   * flow, so opening it moves nothing, and the row it belongs to has the same
   * geometry whether it is open or shut.
   */
  private buildQuickPanel(bar: HTMLElement, quick: QuickPanelOptions): void {
    // The scrim first, so it is behind the panel in paint order without either
    // needing a z-index against the other. Phones only: on a desktop the panel
    // is small and beside its own button, and click-outside already works.
    //
    // Invisible on purpose. It is a tap-catcher, not a modal backdrop: with the
    // pop-out anchored to its button rather than rising from the foot of the
    // screen, dimming everything behind it would claim the whole screen for a
    // menu that only owns a corner of it.
    if (this.options.panelAnchored) {
      const scrim = bar.createDiv({ cls: "ytfree-panel-scrim" });
      this.panelScrim = scrim;
      // On `click`, not `pointerdown`. The scrim's whole job is to be the thing
      // the tap lands on, and a scrim that hides itself on pointerdown is gone
      // by the time the browser picks a click target — the tap then falls
      // through to the modal's own background and closes the Preview as well.
      scrim.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.togglePanel(false);
      });
      scrim.addEventListener("pointerdown", (event) => event.stopPropagation());
    }

    const panel = bar.createDiv({
      cls: "ytfree-panel",
      attr: { role: "dialog", "aria-label": "This video's settings" },
    });
    // Decided once, at construction: the shape of the pop-out is a property of
    // the device, not of the click that opens it, and a class added on a click
    // is a layout change on a click.
    if (this.options.panelAnchored) panel.addClass("ytfree-panel-anchored");
    this.panel = panel;

    const row = (label: string): HTMLElement => {
      const el = panel.createDiv({ cls: "ytfree-panel-row" });
      el.createSpan({ cls: "ytfree-panel-label", text: label });
      return el;
    };

    /** A switch whose knob slides. Fixed box, transform only — no reflow. */
    const toggle = (label: string, on: boolean, onChange: (value: boolean) => void) => {
      const el = row(label).createEl("button", {
        cls: "ytfree-switch",
        attr: { role: "switch", "aria-checked": String(on), "aria-label": label },
      });
      el.type = "button";
      el.createSpan({ cls: "ytfree-switch-knob" });
      el.toggleClass("is-on", on);
      el.addEventListener("click", (e) => {
        e.preventDefault();
        const next = el.getAttribute("aria-checked") !== "true";
        el.setAttribute("aria-checked", String(next));
        el.toggleClass("is-on", next);
        onChange(next);
      });
      return el;
    };

    const choice = (
      label: string,
      values: number[],
      current: number,
      format: (value: number) => string,
      onChange: (value: number) => void,
    ) => {
      const el = row(label).createEl("select", {
        cls: "ytfree-panel-select",
        attr: { "aria-label": label },
      });
      for (const value of values) el.createEl("option", { text: format(value), value: String(value) });
      el.value = String(current);
      el.addEventListener("change", () => onChange(Number(el.value)));
      return el;
    };

    if (this.options.smartSpeed) {
      // Smart Speed's only control now, and the pop-out button on the bar is
      // its only indicator — both painted from `paintSmart`, so the switch, the
      // icon's colour and the engine can never disagree.
      this.smartSwitch = toggle("Smart Speed", this.smartOn, (on) => {
        this.setSmartSpeed(on);
        this.options.smartSpeed?.onToggle?.(on);
      });
      // The time saved, in the label column. The column is `1fr` in a
      // `1fr auto` grid, so a readout that ticks from "" to "−1:04:37" cannot
      // move the switch beside it or resize the panel.
      this.smartBadge = this.smartSwitch.parentElement?.querySelector<HTMLElement>(
        ".ytfree-panel-label",
      )?.createSpan({ cls: "ytfree-panel-value" }) ?? null;

      if (quick.onSkipNonSpeech) {
        toggle("Skip music too", quick.skipNonSpeech ?? false, (on) => quick.onSkipNonSpeech?.(on));
      }

      choice(
        "Pause speed",
        [1.5, 2, 2.5, 3, 4, 5],
        this.options.smartSpeed.silenceRate,
        (value) => `${value}×`,
        (value) =>
          this.setSilenceSettings(this.options.smartSpeed?.minGap ?? 0.5, value),
      );

      choice(
        "Shortest pause",
        [0.2, 0.3, 0.5, 0.8, 1.2],
        this.options.smartSpeed.minGap,
        (value) => `${value}s`,
        (value) =>
          this.setSilenceSettings(value, this.options.smartSpeed?.silenceRate ?? 3),
      );
    }

    if (quick.onPauseWhileTyping) {
      // The other thing that happens to playback without being asked. It was a
      // settings-screen toggle only, which is the wrong place for a decision
      // you make about one video — "let this one run while I write" is a
      // sentence about the lecture in front of you, not about the plugin.
      toggle("Pause while typing", quick.pauseWhileTyping ?? true, (on) =>
        quick.onPauseWhileTyping?.(on),
      );
    }

    if (quick.heightVh !== undefined && quick.onHeight) {
      const el = row("Player size").createEl("input", {
        cls: "ytfree-panel-range",
        attr: { type: "range", min: "20", max: "70", step: "5", "aria-label": "Player size" },
      });
      el.value = String(quick.heightVh);

      /*
       * The panel hangs off the control bar, and the control bar sits under the
       * picture — so resizing the picture moves the panel, and the slider slides
       * out from under the finger that is dragging it. The height still changes
       * live (that is the point of the slider), but the panel is held where it
       * was for as long as the pointer is down: after each change it measures
       * how far it moved and cancels that with a transform. `transform` only, so
       * holding it still reflows nothing. Released on pointerup, where it snaps
       * to the position its new anchor gives it.
       */
      let anchorTop: number | null = null;
      let shift = 0;
      const hold = () => {
        if (anchorTop === null) return;
        shift += anchorTop - panel.getBoundingClientRect().top;
        panel.style.transform = `translateY(${shift.toFixed(2)}px)`;
      };
      const grab = () => {
        // Key repeat fires keydown over and over: re-anchoring on each one
        // would hand back the movement already cancelled.
        if (anchorTop !== null) return;
        shift = 0;
        panel.style.transform = "";
        anchorTop = panel.getBoundingClientRect().top;
      };
      const release = () => {
        if (anchorTop === null) return;
        anchorTop = null;
        shift = 0;
        panel.style.transform = "";
      };
      el.addEventListener("pointerdown", grab);
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      // A keyboard change has no pointer to slide out from under, but it also
      // has no "done" — so it gets the same treatment for the length of the key.
      el.addEventListener("keydown", grab);
      el.addEventListener("keyup", release);
      el.addEventListener("blur", release);
      el.addEventListener("input", () => {
        quick.onHeight?.(Number(el.value));
        hold();
      });
    }

    panel.createDiv({ cls: "ytfree-panel-note", text: "This video only" });

    if (this.options.onOpenSettings) {
      // The way out to the decisions that *do* outlive this note. At the foot
      // of the pop-out, under the line that says everything above it is
      // temporary, because that is exactly the distinction it exists for.
      const el = panel.createEl("button", {
        cls: "ytfree-panel-link",
        text: "All YT Free settings…",
        attr: { "aria-label": "Open YT Free settings" },
      });
      el.type = "button";
      el.addEventListener("click", (event) => {
        event.preventDefault();
        this.togglePanel(false);
        this.options.onOpenSettings?.();
      });
    }

    // Anywhere else, and Escape. Registered on the document because a tap on
    // the note behind the panel is the commonest way to mean "done", and it
    // never reaches this element.
    this.onDocPointer = (event: Event) => {
      if (!this.panelOpen) return;
      const target = event.target as Node | null;
      if (target && (panel.contains(target) || this.panelBtn?.contains(target))) return;
      // The scrim closes itself, on `click`, and it has to stay on screen until
      // then — see above. Closing it here would defeat the point of having it.
      if (target && this.panelScrim?.contains(target)) return;
      this.togglePanel(false);
    };
    this.onDocKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The panel first: Escape means "close the thing on top", and with both
      // open the panel is the thing on top.
      if (this.panelOpen) this.togglePanel(false);
      else if (this.immersive) this.setImmersive(false);
    };
    document.addEventListener("pointerdown", this.onDocPointer, true);
    document.addEventListener("keydown", this.onDocKey);
  }

  private togglePanel(open?: boolean): void {
    const panel = this.panel;
    if (!panel) return;
    this.panelOpen = open ?? !this.panelOpen;

    if (this.panelOpen) {
      this.placePanel();
      this.watchPanelAnchor(true);
    } else {
      this.watchPanelAnchor(false);
    }

    this.panelScrim?.toggleClass("is-open", this.panelOpen);
    panel.toggleClass("is-open", this.panelOpen);
    this.panelBtn?.toggleClass("is-active", this.panelOpen);
    this.panelBtn?.setAttribute("aria-expanded", String(this.panelOpen));
  }

  /**
   * Put the pop-out where it belongs, against whatever it is measured against.
   *
   * Docked (the desktop): the panel is a child of the bar and hangs off it in
   * the bar's own coordinates, so the only measurement is the ceiling. Seven
   * rows on a player a couple of hundred points down the screen would run off
   * the top of it, so it is capped at the room there actually is — measured at
   * the moment it opens, because the bar has a different height in portrait, in
   * landscape and in the immersive view. It scrolls past that.
   *
   * Anchored (the phone): the panel is fixed to the viewport, so everything is
   * measured — which way it opens, how wide it is, and where its left edge sits
   * — from the button's rect and the visible viewport. The inline properties are
   * cleared first: a cap left over from the last open is a cap the natural
   * height would be measured through, and the panel would ratchet smaller every
   * time it was opened lower down the screen.
   *
   * Called again on scroll and resize, which is why it is idempotent and why it
   * measures rather than remembers.
   */
  private placePanel(): void {
    const panel = this.panel;
    if (!panel) return;

    if (!this.options.panelAnchored) {
      const placement = panelPlacement({
        anchored: false,
        barTop: (panel.parentElement ?? this.container).getBoundingClientRect().top,
      });
      panel.style.maxHeight = placement.mode === "docked" ? `${placement.maxHeight}px` : "";
      return;
    }

    const button = this.panelBtn;
    if (!button) return;
    const anchor = button.getBoundingClientRect();

    // The visual viewport, when there is one: on iOS the keyboard and the URL
    // bar shrink what you can see without changing `innerHeight`, and a panel
    // placed against the layout viewport is placed behind them.
    const visual = window.visualViewport;
    const viewport = {
      width: visual?.width ?? window.innerWidth,
      height: visual?.height ?? window.innerHeight,
    };

    if (!anchorVisible(anchor, viewport)) {
      // Scrolled past. Repositioning would park the menu over unrelated content
      // with nothing on screen to say where it came from.
      if (this.panelOpen) this.togglePanel(false);
      return;
    }

    panel.style.maxHeight = "";
    panel.style.width = "";
    const natural = panel.getBoundingClientRect();

    const placement = panelPlacement({
      anchored: true,
      anchor,
      panel: { width: natural.width, height: natural.height },
      viewport,
    });
    if (placement.mode !== "anchored") return;

    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
    panel.style.width = `${placement.width}px`;
    panel.style.maxHeight = `${placement.maxHeight}px`;
    panel.toggleClass("is-below", placement.side === "down");
  }

  /**
   * Follow the button while the pop-out is open, or stop following it.
   *
   * The price of leaving the ancestor's coordinate space: a fixed panel does not
   * move when the Preview sheet scrolls under it. `scroll` is listened for in
   * the capture phase because scroll does not bubble — the sheet's own scroller
   * is the element that fires it, not the window.
   *
   * Nothing here runs while the panel is shut, and `destroy` cannot leave one
   * behind: `togglePanel(false)` is the only way out and it always unhooks.
   */
  private watchPanelAnchor(on: boolean): void {
    if (on) {
      if (this.onPanelReflow || !this.options.panelAnchored) return;
      const reflow = () => this.placePanel();
      this.onPanelReflow = reflow;
      window.addEventListener("scroll", reflow, true);
      window.addEventListener("resize", reflow);
      window.visualViewport?.addEventListener("resize", reflow);
      window.visualViewport?.addEventListener("scroll", reflow);
      return;
    }

    const reflow = this.onPanelReflow;
    if (!reflow) return;
    window.removeEventListener("scroll", reflow, true);
    window.removeEventListener("resize", reflow);
    window.visualViewport?.removeEventListener("resize", reflow);
    window.visualViewport?.removeEventListener("scroll", reflow);
    this.onPanelReflow = null;
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

  // ----------------------------------------------------- Background pausing

  /**
   * A pause the system caused stays paused.
   *
   * Locking the phone or switching apps pauses the video, which is right — the
   * host has no background-audio session, so the sound stops either way. What
   * is wrong is what WebKit does on the way back: it replays its own pause in
   * reverse and starts the audio again, in a note the reader is no longer
   * looking at, with no tap anywhere in the story. So mark the pause as ours
   * the moment it arrives while the document is hidden, and undo the resume
   * that follows it.
   *
   * Ownership is the same idea as `pausedByTyping`, and the same rule applies:
   * the flag is only ever set for a pause this did not request, so a pause the
   * reader performed themselves is never claimed and a play they perform
   * themselves is never cancelled. `play()` clears both the flag and the guard
   * before it starts anything, which is what keeps a lock-screen Play — the one
   * play that legitimately arrives while hidden — from being undone.
   */
  private trackBackgroundPause(): void {
    this.video.addEventListener("pause", () => {
      if (document.hidden && !this.pausedByTyping) this.pausedWhileHidden = true;
    });

    this.video.addEventListener("play", () => {
      const unrequested =
        (document.hidden && this.pausedWhileHidden) || Date.now() < this.resumeGuardUntil;
      if (!unrequested) return;
      // One shot: whatever happens next is the reader's.
      this.pausedWhileHidden = false;
      this.resumeGuardUntil = 0;
      this.video.pause();
    });

    // The resume can land either just before the document goes visible or just
    // after it, so the guard covers both: the flag catches the early one, this
    // window the late one. A second and a half is far longer than the gap and
    // far shorter than a reader reaching for the screen.
    this.onBackgroundVisibility = () => {
      if (document.hidden || !this.pausedWhileHidden) return;
      this.pausedWhileHidden = false;
      this.resumeGuardUntil = Date.now() + 1500;
    };
    document.addEventListener("visibilitychange", this.onBackgroundVisibility);
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

    // Either an instrumental, or a skip this player cannot honour because the
    // target is not buffered. Only the first of those plays fast: a `skip` move
    // carries the *base* rate precisely so that a vetoed jump degrades into
    // doing nothing rather than into audible speed-up. 022's rule — when
    // playback is not confident enough to seek, it fails silent.
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
   * Smart Speed's three states — on, off, and nothing-to-compress — across the
   * switch that sets it and the pop-out icon that reports it. Colour, wording
   * and disabled-ness only; no box anywhere changes size.
   */
  private paintSmart(): void {
    const usable = this.activeWindows.length > 0;
    // The switch in the pop-out is the control; the pop-out's own button is the
    // indicator. Both are painted here rather than by whoever was pressed, so
    // they cannot disagree with the engine or with each other.
    if (this.smartSwitch) {
      this.smartSwitch.toggleClass("is-on", this.smartOn);
      this.smartSwitch.setAttribute("aria-checked", String(this.smartOn));
      this.smartSwitch.disabled = !usable && this.smartReason !== null;
    }

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

    this.smartSwitch?.setAttribute("title", title);
    this.smartSwitch?.setAttribute("aria-label", title);

    const el = this.panelBtn;
    if (el) {
      // Purple while Smart Speed is running, and nothing while it is not. It is
      // the one thing in the pop-out that changes what you hear, so it is the
      // one thing the closed menu has to be able to say.
      el.toggleClass("is-smart", this.smartOn && usable);
      const label = `This video's settings — ${title}`;
      el.setAttribute("title", label);
      el.setAttribute("aria-label", label);
    }
    this.paintSavedTime();
  }

  /**
   * `−1:20` beside the pop-out's Smart Speed label. Blank below a second,
   * because a readout that starts at "−0:00" reads as broken rather than as new.
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
   * Does this video own the Picture-in-Picture window right now?
   *
   * Both engines, for the same reason `togglePip` needs both: iOS implements
   * none of the standard API on a `<video>`, and answers with WebKit's
   * presentation mode instead. Asked at the moment a Preview sheet closes, to
   * decide whether closing it should also stop the video — see `src/preview.ts`.
   */
  inPictureInPicture(): boolean {
    if (document.pictureInPictureElement === this.video) return true;
    const el = this.video as HTMLVideoElement & { webkitPresentationMode?: string };
    return el.webkitPresentationMode === "picture-in-picture";
  }

  /**
   * Call `done` once this video has left Picture-in-Picture.
   *
   * The signal that a kept-alive preview is finished with. Both engines again,
   * and both are checked rather than trusted: `webkitpresentationmodechanged`
   * fires on the way *into* PiP and on the way into fullscreen as well, so the
   * mode is read back before anything is torn down.
   */
  onPictureInPictureEnd(done: () => void): void {
    const fire = (): void => {
      if (this.inPictureInPicture()) return;
      this.video.removeEventListener("leavepictureinpicture", fire);
      this.video.removeEventListener("webkitpresentationmodechanged", fire);
      done();
    };
    this.video.addEventListener("leavepictureinpicture", fire);
    this.video.addEventListener("webkitpresentationmodechanged", fire);
  }

  /**
   * The Fullscreen button, and the one control that must not go through
   * `withMedia` (038).
   *
   * `webkitEnterFullscreen` is honoured only inside the task that handled the
   * tap. On a warm player `withMedia` never awaits, which is why Fullscreen
   * always worked mid-playback; on a cold one it awaits a network round trip,
   * the gesture is long gone by the time the call is made, and the press landed
   * silently in the CSS fallback instead. So: warm players go straight through,
   * with nothing in front of the call, and a cold player is told what it is
   * getting rather than being quietly given the other thing.
   */
  private fullscreenPressed(): void {
    const el = this.video as HTMLVideoElement & { webkitSupportsFullscreen?: boolean };
    this.options.debug?.("fullscreen: pressed", {
      readyState: this.video.readyState,
      webkitSupportsFullscreen: el.webkitSupportsFullscreen ?? null,
      hasRequestFullscreen: typeof this.video.requestFullscreen === "function",
      immersive: this.immersive,
    });

    // On the way out, or already warm: inside the gesture, no await in front.
    if (this.immersive || document.fullscreenElement || this.video.readyState > 0) {
      void this.toggleFullscreen();
      return;
    }

    // Cold. The resolve outlives the tap, so the native call would be refused;
    // start the video anyway — the press is still a request to watch it — and
    // enter our own fullscreen, having said which one this is.
    this.options.debug?.("fullscreen: cold press, resolving first");
    this.onStatus("Full screen in the app — press it again once it is playing for the phone's own");
    window.setTimeout(() => this.onStatus(null), 4000);
    void this.withMedia(() => {
      this.setImmersive(true);
    });
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
    if (this.immersive || document.fullscreenElement) {
      await this.exitFullscreen();
      return;
    }
    await this.enterFullscreen();
  }

  /** Out of whichever kind of fullscreen this player is in. */
  async exitFullscreen(): Promise<void> {
    if (this.immersive) this.setImmersive(false);
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Already gone, or refused. Either way there is nothing to say.
    }
  }

  /**
   * Go fullscreen — the whole screen, whatever the platform will give.
   *
   * The native APIs first, because a native fullscreen video is the better
   * thing: the OS scrubber, the OS rotation, the OS gestures. But an iPhone
   * refuses `webkitEnterFullscreen` when there is no user gesture behind the
   * call, and a phone being turned sideways is not a gesture — which is why
   * rotating did nothing at all before this. So the fallback is the plugin's
   * own: the player is taken out of the note and laid over the screen with CSS,
   * which needs no permission from anyone and cannot be refused.
   */
  async enterFullscreen(): Promise<void> {
    const el = this.video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitSupportsFullscreen?: boolean;
      webkitDisplayingFullscreen?: boolean;
      webkitPresentationMode?: string;
    };
    if (this.immersive || document.fullscreenElement) return;
    if (el.webkitPresentationMode === "fullscreen" || el.webkitDisplayingFullscreen) return;

    try {
      if (typeof this.video.requestFullscreen === "function") {
        await this.video.requestFullscreen();
        return;
      }
    } catch {
      // Fall through rather than dead-ending.
    }

    try {
      if (el.webkitSupportsFullscreen) {
        el.webkitEnterFullscreen?.();
        this.options.debug?.("fullscreen: called webkitEnterFullscreen", {
          readyState: this.video.readyState,
        });
        // It reports failure by doing nothing, so ask a frame later whether it
        // actually happened and cover the case where it did not.
        window.setTimeout(() => {
          if (this.destroyed) return;
          const native = el.webkitDisplayingFullscreen || el.webkitPresentationMode === "fullscreen";
          this.options.debug?.("fullscreen: 250ms later", {
            webkitDisplayingFullscreen: el.webkitDisplayingFullscreen ?? null,
            webkitPresentationMode: el.webkitPresentationMode ?? null,
          });
          if (native) return;
          this.substitute();
        }, 250);
        return;
      }
    } catch {
      // Media not loaded yet, or no gesture behind this call.
    }
    this.options.debug?.("fullscreen: no native path", {
      readyState: this.video.readyState,
      webkitSupportsFullscreen: el.webkitSupportsFullscreen ?? null,
      hasWebkitEnter: typeof el.webkitEnterFullscreen === "function",
    });
    this.substitute();
  }

  /**
   * The CSS fullscreen, entered where the phone's own was wanted (038).
   *
   * Landing here is reasonable; landing here without being told is not — the
   * two look different enough that the reader thinks the button is broken. The
   * message is only for the phone: on a desktop, where `requestFullscreen`
   * exists and works, this is never reached as a substitute.
   */
  private substitute(): void {
    this.setImmersive(true);
    const el = this.video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
    if (typeof el.webkitEnterFullscreen !== "function") return;
    this.onStatus("Full screen in the app — the phone's own needs the video playing first");
    window.setTimeout(() => {
      if (!this.destroyed) this.onStatus(null);
    }, 4000);
  }

  /**
   * The plugin's own fullscreen: the player, fixed over everything, and nothing
   * else on screen.
   *
   * A class on the wrapper, so the picture, the progress line and the control
   * bar all come with it and every control keeps working — which is more than
   * the native one offers on a phone, where our bar disappears behind Apple's.
   * The note underneath is left alone; the wrapper is out of the flow while
   * this is on and drops straight back into it when it goes.
   */
  setImmersive(on: boolean): void {
    if (this.destroyed || this.immersive === on) return;
    this.immersive = on;
    this.container.toggleClass("is-immersive", on);
    document.body.toggleClass("ytfree-immersive-open", on);
    if (!on) this.togglePanel(false);
  }

  get isImmersive(): boolean {
    return this.immersive;
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
        if (this.pendingPlay) this.play();
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
        if (wasPlaying || this.pendingPlay) this.play();
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
      // `pendingPlay` is a Play pressed before this source existed. It is
      // honoured here rather than at the tap, which is the whole point: the
      // button toggled then, the video starts now.
      if (autoplay || this.pendingPlay) this.play();
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
      // There is no source to honour it against any more, and a button stuck at
      // "starting" over a dead stream says nothing true.
      this.setPendingPlay(false);
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
    // Nothing to claim, and something to lose: `load()` on an element that
    // already has media restarts it from the beginning, which since 038's
    // warm-up is the ordinary state of a player nobody has played yet. The
    // gesture only has to be claimed when the media is still to come.
    if (this.video.readyState > 0) return;
    try {
      this.video.load();
    } catch {
      // Nothing to load yet; the flag is what we were after.
    }
  }

  /**
   * Start playback — or, if there is nothing to play yet, remember that this is
   * what was asked for and start the moment there is.
   *
   * Never `video.play()` on a sourceless element: see `hasSource`. Rejection
   * from a real source is normal and not worth reporting.
   */
  play(): void {
    if (this.destroyed) return;
    // Asked for, so the background guard has no claim on it — including the
    // lock-screen Play button, which arrives here while the document is hidden.
    this.pausedWhileHidden = false;
    this.resumeGuardUntil = 0;
    if (!this.hasSource) {
      this.setPendingPlay(true);
      return;
    }
    this.setPendingPlay(false);
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
    // Including a Play that has not landed yet: "stop" means stop, whether the
    // video is playing or still on its way to playing.
    this.setPendingPlay(false);
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
    this.resumeGuardUntil = 0;
    // Before the play, not after: both engines put the panel up on the `play`
    // they are about to receive, and a class added a frame later is a class
    // added after it is already on screen.
    this.hushNativeControls();
    void this.video.play().catch(() => { /* user gesture may be required */ });
  }

  /**
   * Black out the platform's control panel for this one resume.
   *
   * Every `play` puts the native controls up over the picture for a few seconds
   * before they fade — which is right for a play someone pressed and wrong for
   * this one. Pause-while-typing resumes on its own two seconds after the last
   * keystroke, so a reader who is writing gets a bar across the video they were
   * watching, over and over, having asked for nothing.
   *
   * Done in CSS rather than by clearing `controls`, and the difference matters:
   * the engine's own show-and-hide timer keeps running behind the class, so the
   * panel it is hiding has faded of its own accord long before the blackout
   * lifts. Turning `controls` off and on again instead would replay the whole
   * appearance at the moment it came back.
   *
   * It ends early on the first touch of the picture — that *is* someone asking
   * for the controls, and the tap they used to ask must not be spent on
   * cancelling a state they never knew about.
   */
  private hushNativeControls(): void {
    this.video.addClass("is-hushed");
    if (this.hushTimer !== null) window.clearTimeout(this.hushTimer);
    this.hushTimer = window.setTimeout(() => this.unhushNativeControls(), CONTROLS_HUSH_MS);
  }

  private unhushNativeControls(): void {
    if (this.hushTimer !== null) {
      window.clearTimeout(this.hushTimer);
      this.hushTimer = null;
    }
    this.video.removeClass("is-hushed");
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
    // Before the flag, or the class stays on `document.body` — which outlives
    // this player — and every note in the vault keeps its scrolling locked.
    this.setImmersive(false);
    this.destroyed = true;
    this.unhushNativeControls();
    this.stopSmartLoop();
    if (this.onVisibility) {
      document.removeEventListener("visibilitychange", this.onVisibility);
      this.onVisibility = null;
    }
    if (this.onBackgroundVisibility) {
      document.removeEventListener("visibilitychange", this.onBackgroundVisibility);
      this.onBackgroundVisibility = null;
    }
    if (this.onDocPointer) {
      document.removeEventListener("pointerdown", this.onDocPointer, true);
      this.onDocPointer = null;
    }
    if (this.onDocKey) {
      document.removeEventListener("keydown", this.onDocKey);
      this.onDocKey = null;
    }
    // A player torn down with its pop-out open — closing the Preview sheet is
    // exactly that — would otherwise leave a scroll listener on the window
    // measuring a button that no longer exists.
    this.watchPanelAnchor(false);
    this.clearNowPlaying();
    this.teardownHls();
    this.video.removeAttribute("src");
    this.video.load();
    this.container.empty();
  }
}
