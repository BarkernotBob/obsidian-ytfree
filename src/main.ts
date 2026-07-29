import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  App,
  FileSystemAdapter,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  editorLivePreviewField,
  Platform,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
} from "obsidian";
import {
  AccountSession,
  applyWatched,
  channelsFromChannelsPage,
  channelsFromSubsFeed,
  describeSession,
  emptySession,
  looksLikeExpiry,
  mergeWatchLater,
  syncIsDue,
  videoIdsFrom,
} from "./account";
import {
  applyLookback,
  isInsideCodeBlock,
  shouldAutoStamp,
  stampInsertOffset,
} from "./capture";
import type { DownloadHandle } from "./desktop/download.ts";
import { findTimestamps, seekLinkAt } from "./description";
import { formatTimestamp } from "./format";
import {
  HUB_VIEW_TYPE,
  HubSettings,
  HubView,
  ImportSubscriptionsModal,
  SubscriptionsStore,
} from "./hub";
import { ProgressStore } from "./progress-store";
import type { CaptionTrack, Cue, VideoInfo } from "./transcript";
import {
  groupCues,
  HEATMAP_ALIASES,
  HEATMAP_HEADING,
  parseJson3,
  pickCaptionTrack,
  renderHeatmap,
  renderTranscript,
  topPeaks,
  TRANSCRIPT_ALIASES,
  TRANSCRIPT_HEADING,
  upsertSection,
} from "./transcript";
import { fetchCaptionTrack } from "./innertube";
import type { SectionName } from "./sections";
import {
  SECTION_HEADINGS,
  foldableRanges,
  headingLine,
  normaliseHeadings,
} from "./sections";
import { YtFreePlayer } from "./player";
import {
  extractVideoId,
  ResolveMode,
  ResolvedStream,
  StreamCache,
  YtDlpMissingError,
} from "./stream";

/**
 * The single door into the desktop-only code.
 *
 * Everything under `src/desktop/` imports a Node builtin at the top level, and
 * on iOS that throws at module load — before `onload`, so the plugin dies
 * rather than degrading. Only ever reached from behind `Platform.isDesktopApp`;
 * esbuild keeps the dynamically-imported subgraph in a lazily-initialised
 * closure, so the `require` calls happen on first use and never at startup.
 */
type DesktopApi = typeof import("./desktop/index.ts");
let desktopApi: Promise<DesktopApi> | null = null;
function desktop(): Promise<DesktopApi> {
  if (!desktopApi) desktopApi = import("./desktop/index.ts");
  return desktopApi;
}

interface YtFreeSettings {
  ytDlpPath: string;
  upgradeToHighQuality: boolean;
  timestampFormat: string;
  autoStampNewLine: boolean;
  lookbackSeconds: number;
  pauseWhileTyping: boolean;
  resumeIdleMs: number;
  pinnedPlayer: boolean;
  pinnedHeightVh: number;
  pinnedFrontmatterKeys: string;
  collapseProperties: boolean;
  collapseSections: boolean;
  linkifyTimestamps: boolean;
  transcriptLanguage: string;
  transcriptIntervalSeconds: number;
  autoFetchTranscript: boolean;
  heatmapPeaks: number;
  downloadFolder: string;
  ffmpegPath: string;
  subscriptionsPollMinutes: number;
  subscriptionsExpiryDays: number;
  subscriptionsIncludeShorts: boolean;
  watchLaterFolder: string;
  accountSyncHours: number;
  accountHistoryLimit: number;
  accountShowWatched: boolean;
  /** Blank means `defaultCookieFile()` — which needs `os.homedir()`, so it
   * cannot be spelled out in the defaults any more than the download folder can. */
  accountCookieFile: string;
  accountSession: AccountSession;
}

/** Frontmatter key holding the path to a downloaded copy. */
export const LOCAL_MEDIA_KEY = "local_media";

/**
 * How far a finger may move and still count as a tap, in CSS pixels. A finger
 * is never as still as a mouse, so zero tolerance would make every timestamp
 * link a coin flip; anything past this is a scroll or a text selection.
 */
const TAP_SLOP_PX = 10;

/** The rendered timestamp link an event landed on, or null. */
function seekAnchorFor(target: EventTarget | null): HTMLAnchorElement | null {
  const anchor = (target as HTMLElement | null)?.closest?.("a");
  if (!anchor) return null;
  return anchor.getAttribute("href")?.startsWith("ytfree:") ? anchor : null;
}

function withinTapSlop(origin: { x: number; y: number }, touch: Touch): boolean {
  return (
    Math.abs(touch.clientX - origin.x) <= TAP_SLOP_PX &&
    Math.abs(touch.clientY - origin.y) <= TAP_SLOP_PX
  );
}

const DEFAULT_SETTINGS: YtFreeSettings = {
  ytDlpPath: "",
  upgradeToHighQuality: true,
  timestampFormat: "[{ts}]({link}) ",
  autoStampNewLine: true,
  lookbackSeconds: 5,
  pauseWhileTyping: true,
  resumeIdleMs: 2000,
  pinnedPlayer: true,
  pinnedHeightVh: 40,
  pinnedFrontmatterKeys: "media_link, url",
  collapseProperties: true,
  collapseSections: true,
  linkifyTimestamps: true,
  transcriptLanguage: "en",
  transcriptIntervalSeconds: 60,
  autoFetchTranscript: true,
  heatmapPeaks: 8,
  // Blank means "wherever `defaultDownloadFolder()` says", which is
  // ~/Movies/YT Free — deliberately outside the vault, because the vault is in
  // iCloud and a 700MB video inside it would sync to every device. It cannot be
  // spelled out here: `os.homedir()` is unreachable at module load on mobile.
  downloadFolder: "",
  ffmpegPath: "",
  subscriptionsPollMinutes: 60,
  subscriptionsExpiryDays: 0,
  subscriptionsIncludeShorts: false,
  watchLaterFolder: "Watch Later",
  // 12 hours, because yt-dlp's own documentation warns that recurring
  // authenticated requests can get an account flagged. Raising it is a decision
  // with a consequence, not a preference.
  accountSyncHours: 12,
  accountHistoryLimit: 200,
  accountShowWatched: false,
  accountCookieFile: "",
  accountSession: emptySession(),
};

/**
 * Players are keyed by video ID because timestamp links (`ytfree:<id>:<secs>`)
 * carry only the ID. `sourcePath` rides along so flow capture can ask the
 * narrower question it actually needs: which player belongs to *this* note.
 *
 * Known limitation: the same video embedded in two open notes collapses to one
 * entry, last render wins. Not worth a second index until it bites.
 */
/**
 * Why the video is hidden, or null if it is not.
 *
 * The two reasons behave differently on the way back: a collapse the reader
 * asked for stays until they ask for the opposite, while one the keyboard
 * caused is undone by the keyboard going away. Neither ever unmounts the
 * player, so the position — and any audio still playing — survives both.
 */
type CollapseMode = "manual" | "keyboard" | null;

interface PlayerEntry {
  player: YtFreePlayer;
  videoId: string;
  sourcePath: string;
  /** The docked wrapper, so the collapse toggle has something to key off. */
  wrapper: HTMLElement;
  collapsed: CollapseMode;
  /**
   * Mobile: the stream has not been resolved yet. The player is mounted and
   * takes up its final space from the moment the note opens, but nothing is
   * fetched until the poster or a timestamp is tapped — opening a note on
   * cellular should not cost a video.
   *
   * Resolves once; every later caller awaits the same promise.
   */
  activate: (() => Promise<void>) | null;
}

/**
 * What one transcript fetch came back with, whichever platform fetched it.
 *
 * The two sources differ in exactly one field: yt-dlp's info JSON states the
 * replay heatmap, and the InnerTube player response does not. Everything after
 * the harvest — grouping, peaks, rendering, the upsert — is the same code, so a
 * note written on a phone is a note written the same way.
 */
interface CaptionHarvest {
  track: CaptionTrack | null;
  cues: Cue[];
  heatmap: VideoInfo["heatmap"];
}

/**
 * One pinned player per open markdown view, mounted above the note body so it
 * stays put while the note scrolls under it.
 */
interface PinnedEntry {
  videoId: string;
  wrapper: HTMLElement;
  entry: PlayerEntry | null;
}

/**
 * Obsidian's per-file fold record, as it stores it and as both editing modes
 * apply it. None of this is in the public typings — `currentMode.applyFoldInfo`
 * and `app.foldManager` are internals — so every use of it is behind a `try`
 * and degrades to leaving the note exactly as the user left it.
 */
interface FoldInfo {
  folds: Array<{ from: number; to: number }>;
  /** Total line count when the folds were taken; Obsidian discards a stale record. */
  lines: number;
}

interface FoldableMode {
  getFoldInfo?: () => FoldInfo | null;
  applyFoldInfo?: (info: FoldInfo) => void;
  applyScroll?: (line: number) => void;
}

function foldableMode(view: MarkdownView): FoldableMode {
  return view.currentMode as unknown as FoldableMode;
}

export default class YtFreePlugin extends Plugin {
  settings: YtFreeSettings = DEFAULT_SETTINGS;
  private cache = new StreamCache();
  private players = new Map<string, PlayerEntry>();
  private pinned = new Map<MarkdownView, PinnedEntry>();
  /** Last note whose properties we collapsed in a given view, so we do it once. */
  private collapsed = new Map<MarkdownView, string>();
  /** Same, for the default section folds — see applyDefaultFolds. */
  private folded = new Map<MarkdownView, string>();
  /** Scroll listeners pinning a docked view at the top — see holdDockedLayout. */
  private dockGuards = new Map<MarkdownView, () => void>();
  /**
   * The second a timestamp asked for, per video, kept only until the stream
   * resolves. If it never does, the "Open in YouTube" fallback needs it to land
   * where the note pointed instead of at the start.
   */
  private pendingSeek = new Map<string, number>();
  /** Notes created since startup — the only ones eligible for an auto-fetch. */
  private createdThisSession = new Set<string>();
  private autoFetchAttempted = new Set<string>();
  /** Auto-fetches run one at a time, however many notes arrive at once. */
  private autoFetchChain: Promise<void> = Promise.resolve();
  private lastActiveVideoId: string | null = null;
  /** Seek link under the mouse at mousedown, consumed by the matching click. */
  private armedSeekLink: { videoId: string; seconds: number } | null = null;
  /**
   * Where a touch started, so a scroll can be told from a tap.
   *
   * Two of them, and they must stay separate. The document-level capture
   * handler and the CodeMirror handler both see every touch, and capture on
   * `document` runs first — so while these shared one field, the anchor handler
   * cleared the origin on `touchend` before the editor handler could read it,
   * and every Live Preview timestamp tap was thrown away as "no origin". That
   * is exactly why timestamps worked in Reading view and nowhere else.
   */
  private touchOrigin: { x: number; y: number } | null = null;
  private editorTouchOrigin: { x: number; y: number } | null = null;
  /** Reading-view seek anchor under a touchstart, consumed by its touchend. */
  private armedSeekAnchor: HTMLAnchorElement | null = null;
  private ytDlpPath: string | null = null;
  private resumeTimer: number | null = null;
  private downloads = new Map<string, DownloadHandle>();
  /** undefined = not probed yet; null = probed and absent. */
  private ffmpegPath: string | null | undefined = undefined;
  subscriptions!: SubscriptionsStore;
  /** Where each video got to, so reopening a note does not start at 0:00. */
  progress!: ProgressStore;
  /** Authenticated calls are serialized: never two account syncs at once. */
  private accountSyncing = false;
  private settingTab: YtFreeSettingTab | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.progress = new ProgressStore(this.app, `${this.pluginDir()}/progress.json`);
    await this.progress.load();
    await this.setupSubscriptions();
    await this.setupAccount();

    this.registerMarkdownCodeBlockProcessor("ytfree", (source, el, ctx) =>
      this.renderBlock(source, el, ctx),
    );

    // Bare timestamps in a pasted description become seek links at render time.
    this.registerMarkdownPostProcessor((el, ctx) => this.linkifyRendered(el, ctx));

    // Flow capture (issue 001). The stamp rides on the first character typed on
    // a line, so `inputHandler` — which sees real typing and not programmatic
    // edits — is the right hook. Enter is left entirely alone.
    this.registerEditorExtension([
      Prec.highest(
        EditorView.inputHandler.of((view, from, to, text) =>
          this.handleInput(view, from, to, text),
        ),
      ),
      // Live Preview renders links as CodeMirror spans, not <a> elements, so
      // the document-level capture handler above never sees those clicks —
      // Obsidian's editor plugin resolves the URL from the document and hands
      // `ytfree:` to the external-link path, which dead-ends in a "trust this
      // link?" prompt. Intercept at the editor instead, resolving the link the
      // same way it does: from the text under the click.
      Prec.highest(
        EditorView.domEventHandlers({
          mousedown: (evt, view) => {
            this.armedSeekLink = this.editorSeekLinkAt(evt, view, true);
            return false;
          },
          click: (evt, view) => this.handleEditorClick(evt, view),
          // A phone never gets as far as the pair above. iOS does synthesize
          // mouse events, but Obsidian's mobile link handling runs on the touch
          // sequence, so the link is claimed before `mousedown` is dispatched.
          // Arming on touchstart and firing on touchend gets there first, and
          // the preventDefault suppresses the synthetic click that follows, so
          // the seek cannot run twice.
          touchstart: (evt, view) => {
            const touch = evt.touches[0];
            this.editorTouchOrigin = touch ? { x: touch.clientX, y: touch.clientY } : null;
            this.armedSeekLink = touch ? this.editorSeekLinkAt(touch, view, true) : null;
            return false;
          },
          touchend: (evt, view) => {
            const armed = this.armedSeekLink;
            const origin = this.editorTouchOrigin;
            this.armedSeekLink = null;
            this.editorTouchOrigin = null;
            if (!armed || !origin) return false;

            const touch = evt.changedTouches[0];
            // A drag is a scroll or a selection, not a tap on a link.
            if (!touch || !withinTapSlop(origin, touch)) return false;
            const now = this.editorSeekLinkAt(touch, view, false);
            if (!now || now.videoId !== armed.videoId || now.seconds !== armed.seconds) {
              return false;
            }

            evt.preventDefault();
            this.followSeekLink(armed.videoId, armed.seconds);
            return true;
          },
        }),
      ),
    ]);

    this.addCommand({
      id: "insert-timestamp",
      name: "Insert timestamp at cursor",
      editorCallback: (editor, ctx) => {
        const path = ctx instanceof MarkdownView ? ctx.file?.path : undefined;
        const entry = this.playerForPath(path) ?? this.anyPlayer();
        if (!entry) {
          new Notice("YT Free: no player in this note yet. Play a video first.");
          return;
        }
        editor.replaceSelection(this.stampFor(entry));
      },
    });

    this.addCommand({
      id: "insert-block-from-clipboard",
      name: "Insert player from YouTube URL in clipboard",
      editorCallback: async (editor) => {
        const clip = (await navigator.clipboard.readText()).trim();
        const id = extractVideoId(clip);
        if (!id) {
          new Notice("YT Free: clipboard does not contain a YouTube URL.");
          return;
        }
        editor.replaceSelection("```ytfree\n" + id + "\n```\n");
      },
    });

    // Timestamp links use a custom scheme, so intercept their clicks ourselves.
    // Capture phase: Obsidian's own link handler treats an unrecognized scheme
    // as an external link, shows a "trust this link?" prompt, and on trust hands
    // it to `shell.openExternal`, which no-ops since `ytfree:` isn't a
    // registered OS protocol. That handler runs on bubble, so listening on
    // `document` in the bubble phase (the original approach) loses the race —
    // Obsidian's `stopPropagation()` fires first and we never see the click.
    // Capture on `document` runs before any bubble-phase listener anywhere in
    // the tree, so we get first refusal regardless of where Obsidian attaches.
    this.registerDomEvent(
      document,
      "click",
      (evt) => {
        const anchor = seekAnchorFor(evt.target);
        if (!anchor) return;

        evt.preventDefault();
        evt.stopPropagation();

        const [, videoId, seconds] = (anchor.getAttribute("href") ?? "").split(":");
        this.followSeekLink(videoId, Number(seconds) || 0);
      },
      { capture: true },
    );

    // …and the same anchor on a phone, where Obsidian resolves the link from
    // the touch sequence and the click above arrives too late to matter. Same
    // arm-then-fire shape as the editor handler, for the same reason.
    this.registerDomEvent(
      document,
      "touchstart",
      (evt) => {
        const touch = evt.touches[0];
        const anchor = seekAnchorFor(evt.target);
        this.touchOrigin = touch && anchor ? { x: touch.clientX, y: touch.clientY } : null;
        this.armedSeekAnchor = touch ? anchor : null;
      },
      { capture: true, passive: true },
    );
    this.registerDomEvent(
      document,
      "touchend",
      (evt) => {
        const armed = this.armedSeekAnchor;
        const origin = this.touchOrigin;
        this.armedSeekAnchor = null;
        this.touchOrigin = null;
        if (!armed || !origin) return;

        const touch = evt.changedTouches[0];
        if (!touch || !withinTapSlop(origin, touch)) return;
        if (seekAnchorFor(document.elementFromPoint(touch.clientX, touch.clientY)) !== armed) {
          return;
        }

        evt.preventDefault();
        evt.stopPropagation();

        const [, videoId, seconds] = (armed.getAttribute("href") ?? "").split(":");
        this.followSeekLink(videoId, Number(seconds) || 0);
      },
      { capture: true },
    );

    // The video folds away while the keyboard is up. Focus is what makes it
    // immediate — waiting for the keyboard's own animation would collapse the
    // video a beat after the text had already been shoved off screen.
    if (!Platform.isDesktopApp) {
      this.registerDomEvent(document, "focusin", (evt) => {
        const target = evt.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.closest(".markdown-source-view")) return;
        this.collapseForKeyboard();
      });

      // …and unfolds when the keyboard goes, however it went: the Done button
      // blurs the editor, a swipe-down does not.
      this.registerDomEvent(document, "focusout", () => {
        window.setTimeout(() => {
          if (!this.keyboardIsOpen()) this.releaseKeyboardCollapse();
        }, 150);
      });
      const vv = window.visualViewport;
      if (vv) {
        // Not registerDomEvent: its overloads only cover Document, Window and
        // HTMLElement, and the visual viewport is none of the three.
        const onResize = (): void => {
          if (!this.keyboardIsOpen()) this.releaseKeyboardCollapse();
        };
        vv.addEventListener("resize", onResize);
        this.register(() => vv.removeEventListener("resize", onResize));
      }
    }

    // Pinned player: driven entirely off frontmatter, so opening a Watch Later
    // note is the whole interaction. Re-synced on anything that can change which
    // note is on screen or what its frontmatter says.
    this.app.workspace.onLayoutReady(() => this.syncPinnedPlayers());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncPinnedPlayers()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncPinnedPlayers()));
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncPinnedPlayers();
        if (file) this.queueAutoFetch(file);
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.syncPinnedPlayers();
        this.queueAutoFetch(file);
      }),
    );

    // Registered only after layout is ready: during startup Obsidian fires
    // `create` for every file already in the vault, which would make the whole
    // vault look new and queue a transcript fetch for all of it.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (!(file instanceof TFile) || file.extension !== "md") return;
          this.createdThisSession.add(file.path);
          // A clipped note arrives complete, so its frontmatter may already be
          // readable here. Free to try: with no video ID yet this does nothing
          // and does not count as an attempt, so `changed` still gets its turn.
          this.queueAutoFetch(file);
        }),
      );
    });

    // Templater renames a note after filling it in, so the path recorded at
    // create time is not the path the fetch will see.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.createdThisSession.delete(oldPath) && file instanceof TFile) {
          this.createdThisSession.add(file.path);
        }
        if (this.autoFetchAttempted.delete(oldPath) && file instanceof TFile) {
          this.autoFetchAttempted.add(file.path);
        }
      }),
    );

    // Downloading shells out to yt-dlp, which does not exist on a phone.
    // Registering these anyway would put commands in mobile's palette that can
    // only ever answer with an error.
    if (Platform.isDesktopApp) {
      this.addCommand({
        id: "download-video",
        name: "Download this video for offline",
        callback: () => void this.downloadForActiveNote(),
      });

      this.addCommand({
        id: "delete-local-copy",
        name: "Delete the local copy of this video",
        callback: () => void this.deleteLocalCopy(),
      });
    }

    // Transcript is on both now: the phone reads captions off the InnerTube
    // player response, which needs no yt-dlp. Replay peaks are still desktop
    // only — see `harvestWithInnertube` for why.
    this.addCommand({
      id: "fetch-transcript",
      name: Platform.isDesktopApp
        ? "Fetch transcript and most-replayed moments"
        : "Fetch transcript",
      callback: () => void this.fetchTranscriptForActiveNote(),
    });

    this.addCommand({
      id: "toggle-pinned-player",
      name: "Toggle pinned player for this note",
      callback: async () => {
        this.settings.pinnedPlayer = !this.settings.pinnedPlayer;
        await this.saveSettings();
        this.syncPinnedPlayers();
        new Notice(`YT Free: pinned player ${this.settings.pinnedPlayer ? "on" : "off"}.`);
      },
    });

    this.addCommand({
      id: "normalise-headings",
      name: "Rename this note's sections to Video Description / Video Transcript",
      callback: () => void this.normaliseHeadingsInActiveNote(),
    });

    this.settingTab = new YtFreeSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
  }

  /**
   * Bring an older note's headings up to the current names.
   *
   * Notes written before this rename carry `## Notes`, `## Description` and
   * `## Transcript`, and every part of the plugin that looks for a section
   * still accepts those — so this is opt-in, one note at a time, rather than a
   * migration that rewrites fifty files the first time the plugin loads.
   */
  private async normaliseHeadingsInActiveNote(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) {
      new Notice("YT Free: open the note first.");
      return;
    }

    let changed = false;
    await this.app.vault.process(file, (content) => {
      const next = normaliseHeadings(content);
      changed = next !== content;
      return next;
    });
    new Notice(changed ? "YT Free: headings updated." : "YT Free: headings already current.");
  }

  // ---------------------------------------------------------- subscriptions

  /** This plugin's own folder — where the state files that are not settings live. */
  private pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  /**
   * The subscriptions hub (issue 003).
   *
   * State lives in its own file next to `data.json` rather than inside it: the
   * index is thousands of rows, and settings should not be rewritten every time
   * a poll lands.
   */
  private async setupSubscriptions(): Promise<void> {
    const dir = this.pluginDir();
    this.subscriptions = new SubscriptionsStore(
      this.app,
      `${dir}/subscriptions.json`,
      () => this.hubSettings(),
    );
    await this.subscriptions.load();

    this.registerView(
      HUB_VIEW_TYPE,
      (leaf) =>
        new HubView(leaf, this.subscriptions, () => this.hubSettings(), () => this.syncNow()),
    );

    this.addRibbonIcon("youtube", "YT Free subscriptions", () => void this.openHub());

    this.addCommand({
      id: "open-subscriptions-hub",
      name: "Open subscriptions hub",
      callback: () => void this.openHub(),
    });

    this.addCommand({
      id: "import-subscriptions",
      name: "Import YouTube subscriptions",
      callback: () => {
        new ImportSubscriptionsModal(this.app, this.subscriptions, () => {
          void this.openHub().then(() => void this.subscriptions.poll().then(() => this.refreshHub()));
        }).open();
      },
    });

    this.addCommand({
      id: "poll-subscriptions",
      name: "Check subscriptions for new videos",
      callback: () => {
        if (this.subscriptions.state.channels.length === 0) {
          new Notice("YT Free: no channels yet. Run “Import YouTube subscriptions” first.");
          return;
        }
        void this.subscriptions.poll().then(() => this.refreshHub());
      },
    });

    // Polling on load is the only thing that narrows the real limitation here:
    // the feed is a 15-entry window with no backfill, so a channel that posts
    // 16 videos while Obsidian is closed loses the oldest permanently.
    this.app.workspace.onLayoutReady(() => void this.maybePoll(5));

    // A fixed ticker asking "is it due yet", rather than an interval set to the
    // poll period: changing the period in settings takes effect immediately
    // instead of at the next restart.
    this.registerInterval(window.setInterval(() => void this.maybePoll(), 60_000));
  }

  /**
   * One "sync", with one meaning: the hub's sync button and the settings pane's
   * Sync now both run this, so they cannot drift apart or report differently.
   *
   * The account goes first — it is what adds channels and Watch Later items —
   * and the feed poll then fills in descriptions for whatever it added. When
   * there is no session, the account half is skipped silently rather than
   * nagging someone who deliberately never signed in.
   */
  async syncNow(): Promise<void> {
    const signedIn =
      Platform.isDesktopApp && this.settings.accountSession.status === "signed-in";
    if (signedIn) await this.syncAccount(true);
    await this.subscriptions.poll();
    this.refreshHub();
    // Without a session `syncAccount` said nothing, so the click needs its own
    // acknowledgement — a button that flashes nothing looks broken.
    if (!signedIn) {
      new Notice(`YT Free: checked ${this.subscriptions.state.channels.length} channels.`);
    }
  }

  /** Poll if the last one is older than the configured gap (or `floor`). */
  private async maybePoll(floorMinutes?: number): Promise<void> {
    const minutes = floorMinutes ?? Math.max(5, this.settings.subscriptionsPollMinutes);
    const last = Date.parse(this.subscriptions.state.lastPolledAt ?? "");
    if (Number.isFinite(last) && Date.now() - last < minutes * 60_000) return;
    await this.subscriptions.poll();
    this.refreshHub();
  }

  hubSettings(): HubSettings {
    return {
      pollMinutes: this.settings.subscriptionsPollMinutes,
      expiryDays: this.settings.subscriptionsExpiryDays,
      includeShorts: this.settings.subscriptionsIncludeShorts,
      watchLaterFolder: this.settings.watchLaterFolder,
      showWatched: this.settings.accountShowWatched,
    };
  }

  // --------------------------------------------------------------- account

  /**
   * The signed-in half (issue 006): subscriptions, Watch Later and history come
   * *in*; nothing goes out. Cookies are attached here and nowhere else in the
   * plugin — not to playback, not to stream resolution, not to RSS polling, not
   * to transcripts or downloads. That split is the feature: what you watch in
   * Obsidian is never attributed to your YouTube account.
   */
  private async setupAccount(): Promise<void> {
    if (!Platform.isDesktopApp) return;

    this.addCommand({
      id: "sign-in-youtube",
      name: "Sign in to YouTube",
      callback: () => void this.signIn(),
    });

    this.addCommand({
      id: "sign-out-youtube",
      name: "Sign out of YouTube",
      callback: () => void this.signOut(),
    });

    this.addCommand({
      id: "sync-account",
      name: "Sync account now (subscriptions, Watch Later, history)",
      callback: () => void this.syncAccount(true),
    });

    // Shares the subscriptions ticker's shape — ask "is it due yet" every
    // minute — so changing the period in settings takes effect immediately.
    this.registerInterval(
      window.setInterval(() => {
        if (syncIsDue(this.settings.accountSession, this.settings.accountSyncHours, new Date())) {
          void this.syncAccount(false);
        }
      }, 60_000),
    );
  }

  async signIn(): Promise<void> {
    if (!Platform.isDesktopApp) return;
    const { SignInModal, resolveCookieFile, writeCookieFile } = await desktop();
    new SignInModal(this.app, async ({ cookies, name }) => {
      const file = resolveCookieFile(this.settings.accountCookieFile);
      writeCookieFile(file, cookies);
      this.settings.accountSession = {
        status: "signed-in",
        name,
        lastSyncAt: null,
        lastError: null,
      };
      await this.saveSettings();
      this.refreshSettingsTab();
      // The first sync is the proof that any of it worked, so it is not left
      // to the schedule twelve hours from now.
      void this.syncAccount(true);
    }).open();
  }

  async signOut(): Promise<void> {
    if (!Platform.isDesktopApp) return;
    const { clearSignInPartition, deleteCookieFile, resolveCookieFile } = await desktop();
    await clearSignInPartition();
    const file = resolveCookieFile(this.settings.accountCookieFile);
    const deleted = deleteCookieFile(file);
    this.settings.accountSession = emptySession();
    await this.saveSettings();
    this.refreshSettingsTab();
    new Notice(
      deleted
        ? "YT Free: signed out. The cookie file is deleted."
        : "YT Free: signed out. There was no cookie file to delete.",
    );
  }

  /**
   * One authenticated cycle: all three lists, in order, never concurrently.
   *
   * On failure the session is marked expired only when the error looks like an
   * expired session — a timeout is not a sign-out, and treating it as one would
   * make a flaky network log you out. Everything else records the error and
   * *still* advances the clock, so a broken sync waits a full period instead of
   * retrying every minute. Hammering is the thing that gets an account flagged;
   * failing quietly for twelve hours is not.
   */
  async syncAccount(manual: boolean): Promise<void> {
    if (!Platform.isDesktopApp) return;
    const session = this.settings.accountSession;
    if (session.status !== "signed-in") {
      if (manual) new Notice("YT Free: not signed in. Run “Sign in to YouTube” first.");
      return;
    }
    if (this.accountSyncing) {
      if (manual) new Notice("YT Free: a sync is already running.");
      return;
    }
    this.accountSyncing = true;
    if (manual) new Notice("YT Free: syncing your account…");

    const api = await desktop();
    try {
      const cookieFile = api.resolveCookieFile(this.settings.accountCookieFile);
      if (!api.cookieFileExists(cookieFile)) {
        throw new Error("cookies are no longer valid: the cookie file is gone");
      }
      const ytDlpPath = await this.resolveYtDlp();

      // Subscriptions. `/feed/channels` is the subscription manager and lists
      // every channel; `:ytsubs` is the subscription *feed* and its entries are
      // videos, so it only names channels that have posted recently. The first
      // is what a Takeout export matches, so it goes first and the second is a
      // fallback rather than an equivalent.
      let channels = channelsFromChannelsPage(
        await api
          .listWithCookies(ytDlpPath, cookieFile, api.ACCOUNT_TARGETS.channelsPage)
          .catch(() => []),
      );
      let source = "subscription manager";
      if (channels.length === 0) {
        channels = channelsFromSubsFeed(
          await api.listWithCookies(ytDlpPath, cookieFile, api.ACCOUNT_TARGETS.subsFeed, {
            limit: 300,
          }),
        );
        source = "subscription feed";
      }
      const addedChannels = channels.length > 0 ? this.subscriptions.addChannels(channels) : 0;

      // Watch Later.
      const wlRows = await api.listWithCookies(
        ytDlpPath,
        cookieFile,
        api.ACCOUNT_TARGETS.watchLater,
      );
      const merged = mergeWatchLater(this.subscriptions.state.items, wlRows, new Date());
      this.subscriptions.state.items = merged.items;

      // History, bounded. The full list is enormous and almost all of it is
      // irrelevant to a hub that only holds the last thirty days.
      const historyRows = await api.listWithCookies(
        ytDlpPath,
        cookieFile,
        api.ACCOUNT_TARGETS.history,
        { limit: Math.max(1, this.settings.accountHistoryLimit) },
      );
      const marked = applyWatched(this.subscriptions.state.items, videoIdsFrom(historyRows));

      await this.subscriptions.save();
      this.refreshHub();

      this.settings.accountSession = {
        ...session,
        status: "signed-in",
        lastSyncAt: new Date().toISOString(),
        lastError: null,
      };
      await this.saveSettings();
      this.refreshSettingsTab();

      if (manual) {
        new Notice(
          `YT Free: ${channels.length} channels from the ${source} (${addedChannels} new), ` +
            `${merged.added} new from Watch Later, ${marked} marked watched.`,
          8000,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const expired = looksLikeExpiry(message);
      this.settings.accountSession = {
        ...session,
        status: expired ? "expired" : "signed-in",
        // Advancing the clock on a failure is deliberate: see the note above.
        lastSyncAt: expired ? session.lastSyncAt : new Date().toISOString(),
        lastError: message.slice(0, 300),
      };
      await this.saveSettings();
      this.refreshSettingsTab();
      if (manual || expired) {
        new Notice(
          expired
            ? "YT Free: your YouTube session expired. Sign in again — syncing has stopped until you do."
            : `YT Free: account sync failed — ${message}`,
          10000,
        );
      }
      console.error("YT Free: account sync failed.", err);
    } finally {
      this.accountSyncing = false;
    }
  }

  /** Redraw an open settings tab, so a status line is never stale on screen. */
  private refreshSettingsTab(): void {
    this.settingTab?.refresh();
  }

  /** Re-filter every open hub. Poll results can change what a filter matches. */
  refreshHub(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(HUB_VIEW_TYPE)) {
      if (leaf.view instanceof HubView) leaf.view.renderAll();
    }
  }

  private async openHub(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(HUB_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    // A full tab, not the sidebar: the hub is a grid of thumbnails and a
    // 250px-wide strip makes it unreadable.
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: HUB_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  onunload(): void {
    this.clearResumeTimer();
    for (const handle of this.downloads.values()) handle.cancel();
    this.downloads.clear();
    for (const view of [...this.pinned.keys()]) this.unmountPinned(view);
    for (const entry of this.players.values()) entry.player.destroy();
    this.players.clear();
    this.cache.clear();
    // After the players, not before: each `destroy` reports its final position,
    // and this is the write that gets those positions onto disk.
    void this.progress.flush();
  }

  // ---------------------------------------------------------------- pinned

  /**
   * The video a note's frontmatter points at, or null.
   *
   * Reads the same `media_link` property the vault already writes, so existing
   * Watch Later notes light up without being touched.
   */
  pinnedVideoIdFor(path: string | undefined): string | null {
    if (!this.settings.pinnedPlayer) return null;
    return this.videoIdForNote(path);
  }

  /** Same lookup, without the pinned-player gate — downloads need it either way. */
  videoIdForNote(path: string | undefined): string | null {
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm) return null;

    for (const key of this.settings.pinnedFrontmatterKeys.split(",").map((k) => k.trim())) {
      if (!key) continue;
      const value = fm[key];
      const raw = Array.isArray(value) ? value[0] : value;
      if (typeof raw !== "string") continue;
      const id = extractVideoId(raw);
      if (id) return id;
    }
    return null;
  }

  /**
   * Reconcile every open markdown view against what its frontmatter asks for.
   * Idempotent: a view already showing the right video is left alone, so the
   * frequent events driving this never interrupt playback.
   */
  private syncPinnedPlayers(): void {
    const open = new Set<MarkdownView>();

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      open.add(view);

      const path = view.file?.path;
      const wanted = this.pinnedVideoIdFor(path);
      const current = this.pinned.get(view);

      // Keyed off "this note has a video", not off the player, so it still
      // applies when the pinned player is switched off.
      if (path && this.videoIdForNote(path)) {
        this.collapseProperties(view, path);
        this.applyDefaultFolds(view, path);
      } else if (path) {
        if (this.collapsed.get(view) !== path) this.collapsed.delete(view);
        if (this.folded.get(view) !== path) this.folded.delete(view);
      }

      // `isConnected` catches the case where Obsidian rebuilt the view's DOM
      // under us — same video, but our node is no longer in the document.
      if (current && current.videoId === wanted && current.wrapper.isConnected) continue;

      if (current) this.unmountPinned(view);
      if (wanted && view.file) void this.mountPinned(view, wanted, view.file.path);
    }

    for (const view of [...this.pinned.keys()]) {
      if (!open.has(view)) this.unmountPinned(view);
    }
    for (const view of [...this.collapsed.keys()]) {
      if (!open.has(view)) this.collapsed.delete(view);
    }
    for (const view of [...this.folded.keys()]) {
      if (!open.has(view)) this.folded.delete(view);
    }
  }

  // ------------------------------------------------------------- properties

  /**
   * Collapse the properties table on a video note.
   *
   * A Watch Later note carries eleven properties, and with the pinned player
   * above them the note's own text starts a screen and a half down. Collapsing
   * is per-note behaviour, so it can't be the global Obsidian setting, and CSS
   * can't express "collapsed until clicked" — hence doing it here.
   *
   * Clicking Obsidian's own heading rather than setting `is-collapsed` directly
   * keeps its internal state and the arrow in agreement, so the first click to
   * re-open works. Done once per file per view: if you expand the properties,
   * they stay expanded until you open a different note.
   */
  private collapseProperties(view: MarkdownView, path: string): void {
    if (!this.settings.collapseProperties) return;
    if (this.collapsed.get(view) === path) return;

    // The metadata table is built with the rest of the view, which may not have
    // happened yet when frontmatter is what told us to mount in the first place.
    let attempts = 0;
    const attempt = (): void => {
      if (view.file?.path !== path) return;
      const container = view.contentEl.querySelector<HTMLElement>(".metadata-container");
      if (!container) {
        if (++attempts < 10) window.setTimeout(attempt, 100);
        return;
      }
      this.collapsed.set(view, path);
      if (container.hasClass("is-collapsed")) return;
      const heading = container.querySelector<HTMLElement>(".metadata-properties-heading");
      if (heading) heading.click();
      // Belt and braces: if a future Obsidian stops toggling on that click, fall
      // back to the class the stylesheet actually keys on.
      if (!container.hasClass("is-collapsed")) container.addClass("is-collapsed");
    };
    attempt();
  }

  // ---------------------------------------------------------------- sections

  /** The open markdown view showing `path`, if one is. */
  private viewForPath(path: string): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === path) return view;
    }
    return null;
  }

  /** Read the view's folds, or null when this Obsidian won't say. */
  private foldsOf(view: MarkdownView): FoldInfo | null {
    try {
      return foldableMode(view).getFoldInfo?.() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Apply folds to the view and record them against the file.
   *
   * Both halves matter: the first is what the reader sees now, the second is
   * what Obsidian restores when the note is reopened. Saving without applying
   * would make the change appear only on the second visit.
   */
  private setFolds(view: MarkdownView, info: FoldInfo): void {
    try {
      foldableMode(view).applyFoldInfo?.(info);
    } catch {
      /* older or newer Obsidian: leave the note alone */
    }
    try {
      const manager = (this.app as unknown as {
        foldManager?: { save?: (file: TFile, info: FoldInfo) => void };
      }).foldManager;
      if (view.file) manager?.save?.(view.file, info);
    } catch {
      /* the record is a convenience, not a requirement */
    }
  }

  /**
   * Open a video note with Notes showing and everything below it folded away.
   *
   * A finished note is mostly transcript — several thousand words of it — and
   * the description runs to a wall of links, so a note opened flat starts with
   * the one section you wrote in it pushed off the bottom of the screen. The
   * fold is the default state, not a lock: unfold a section and it stays
   * unfolded for as long as the note is open, because this runs once per file
   * per view, exactly like `collapseProperties`.
   */
  private applyDefaultFolds(view: MarkdownView, path: string): void {
    if (!this.settings.collapseSections) return;
    if (this.folded.get(view) === path) return;

    let attempts = 0;
    const attempt = (): void => {
      if (view.file?.path !== path) return;

      // The document arrives after the view does. An empty editor here means
      // "not loaded yet", not "empty note" — the note has frontmatter at least.
      let content = "";
      try {
        content = view.editor?.getValue() ?? "";
      } catch {
        content = "";
      }
      if (!content.trim()) {
        if (++attempts < 20) window.setTimeout(attempt, 100);
        return;
      }

      this.folded.set(view, path);
      const ranges = foldableRanges(content, [
        SECTION_HEADINGS.description,
        SECTION_HEADINGS.transcript,
        HEATMAP_ALIASES,
      ]);
      if (ranges.length === 0) return;
      this.setFolds(view, { folds: ranges, lines: content.split("\n").length });
    };
    attempt();
  }

  /**
   * Scroll the note to one of its sections, unfolding it on the way.
   *
   * Jumping to a folded heading would otherwise land you on a heading with
   * nothing under it, which reads as a broken link — so the fold covering the
   * target is dropped first, and only that one: the other sections stay as the
   * reader left them.
   */
  private jumpToSection(file: TFile, section: SectionName): void {
    const view = this.viewForPath(file.path);
    if (!view) return;

    let content = "";
    try {
      content = view.editor?.getValue() ?? "";
    } catch {
      content = "";
    }
    const line = headingLine(content, SECTION_HEADINGS[section]);
    if (line < 0) {
      new Notice(`YT Free: this note has no ${SECTION_HEADINGS[section][0]} section.`);
      return;
    }

    const folds = this.foldsOf(view);
    if (folds) {
      const kept = folds.folds.filter((fold) => fold.from !== line);
      if (kept.length !== folds.folds.length) this.setFolds(view, { ...folds, folds: kept });
    }

    // Once the unfold has been laid out, or the scroll lands at the old height.
    window.setTimeout(() => {
      try {
        foldableMode(view).applyScroll?.(line);
      } catch {
        /* nothing to do but leave the reader where they were */
      }
      // Tapping Notes is how you start writing, so put the cursor where the
      // typing goes. Only there: a cursor parked in the transcript would send
      // the next thing you type into someone else's words.
      if (section === "notes" && view.getMode() === "source") {
        try {
          view.editor.setCursor({ line: line + 1, ch: 0 });
          view.editor.focus();
        } catch {
          /* reading mode, or no editor: the scroll was the point anyway */
        }
      }
    }, 0);
  }

  // -------------------------------------------------------- transcript auto

  /**
   * Consider a note for an automatic transcript fetch.
   *
   * Deliberately limited to notes created during this session. Both sources
   * that matter — the Templater template and the Web Clipper — create a file,
   * so that single condition covers both without either needing to know the
   * plugin exists. It also means opening an old note never triggers a surprise
   * network call and a five-thousand-word append.
   *
   * Driven off `metadataCache.changed` rather than `vault.create`, because at
   * create time a Templater note is still empty: the frontmatter naming the
   * video does not exist yet. This fires again once it does.
   */
  private queueAutoFetch(file: TFile): void {
    if (!this.settings.autoFetchTranscript) return;
    if (!this.createdThisSession.has(file.path)) return;
    if (this.autoFetchAttempted.has(file.path)) return;

    const videoId = this.videoIdForNote(file.path);
    if (!videoId) return;

    this.autoFetchAttempted.add(file.path);

    // Serialized: clipping four videos in a row should not put four yt-dlp
    // processes on the machine at once. Each is only a few seconds.
    this.autoFetchChain = this.autoFetchChain
      .then(() => this.autoFetchTranscript(file, videoId))
      .catch(() => undefined);
  }

  private async autoFetchTranscript(file: TFile, videoId: string): Promise<void> {
    // The template is still writing and renaming when the frontmatter first
    // parses. Let it finish rather than racing it for the file.
    await new Promise((resolve) => window.setTimeout(resolve, 1500));

    if (!(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) return;

    // Re-read rather than trusting the earlier check: the note may have gained a
    // transcript in the meantime, from the command or from sync.
    const content = await this.app.vault.cachedRead(file);
    if (content.includes(TRANSCRIPT_HEADING)) return;

    await this.fetchTranscriptInto(file, videoId, true);
  }

  // ------------------------------------------------------------- transcript

  /**
   * Write a timestamped transcript and a most-replayed list into the note.
   *
   * This is the answer for a video whose uploader wrote no chapters — which is
   * most of them. Every paragraph is a seek link, so the transcript is not just
   * something to read: search a phrase in the vault, click, and the pinned
   * player lands on the second it was said.
   *
   * Available as a command for any note, and run automatically for notes
   * created this session — see `queueAutoFetch`.
   */
  private async fetchTranscriptForActiveNote(): Promise<void> {
    const context = this.activeNoteVideo();
    if (!context) {
      new Notice("YT Free: this note does not name a video.");
      return;
    }
    await this.fetchTranscriptInto(context.file, context.videoId, false);
  }

  /**
   * The work itself, shared by the command and the automatic path.
   *
   * `quiet` only suppresses the "nothing to add" case. A real failure always
   * says so: a note that silently lacks a transcript looks identical to a video
   * that has no captions, and telling those apart afterwards is guesswork.
   */
  private async fetchTranscriptInto(file: TFile, videoId: string, quiet: boolean): Promise<void> {
    const progress = new Notice("YT Free: fetching transcript…", 0);
    try {
      const harvest = Platform.isDesktopApp
        ? await this.harvestWithYtDlp(videoId)
        : await this.harvestWithInnertube(videoId);
      // Only the desktop path reports a missing yt-dlp, and it has already said
      // so in a Notice of its own.
      if (!harvest) {
        progress.hide();
        return;
      }
      const { track, cues, heatmap } = harvest;

      const paragraphs = groupCues(cues, this.settings.transcriptIntervalSeconds);
      const peaks = topPeaks(heatmap, this.settings.heatmapPeaks);

      if (paragraphs.length === 0 && peaks.length === 0) {
        progress.hide();
        if (!quiet) {
          new Notice(
            track
              ? "YT Free: captions were empty for this video."
              : `YT Free: no ${this.settings.transcriptLanguage} captions for this video.`,
            8000,
          );
        }
        return;
      }

      await this.app.vault.process(file, (content) => {
        // Heatmap first: it is the short list you scan, and the transcript is
        // the long thing you scroll past everything else to reach.
        // Aliases, so a note still carrying the old `## Transcript` has that
        // section replaced rather than a second one appended beneath it.
        let next = upsertSection(
          content,
          HEATMAP_HEADING,
          renderHeatmap(peaks, cues, videoId),
          HEATMAP_ALIASES,
        );
        next = upsertSection(
          next,
          TRANSCRIPT_HEADING,
          renderTranscript(paragraphs, videoId, track),
          TRANSCRIPT_ALIASES,
        );
        return next;
      });

      progress.hide();
      const parts: string[] = [];
      if (paragraphs.length) parts.push(`${paragraphs.length} transcript sections`);
      if (peaks.length) parts.push(`${peaks.length} replay peaks`);
      new Notice(`YT Free: added ${parts.join(" and ")}.`);
    } catch (err) {
      progress.hide();
      const detail = err instanceof Error ? err.message : String(err);
      new Notice(`YT Free: transcript failed — ${detail}`, 10000);
    }
  }

  /**
   * The desktop harvest: yt-dlp's info JSON, which carries the caption
   * tracklist and the replay heatmap in one call.
   *
   * Returns null — rather than throwing — for the one failure that is a setup
   * problem instead of a fetch problem, because the Notice it needs is specific
   * and there is nothing to retry.
   */
  private async harvestWithYtDlp(videoId: string): Promise<CaptionHarvest | null> {
    const { fetchVideoInfo, findYtDlp } = await desktop();

    let ytDlpPath: string;
    try {
      ytDlpPath = this.ytDlpPath ?? (await findYtDlp(this.settings.ytDlpPath));
      this.ytDlpPath = ytDlpPath;
    } catch {
      new Notice("YT Free: yt-dlp not found. Install it, or set its path in settings.");
      return null;
    }

    const info = await fetchVideoInfo(ytDlpPath, videoId);
    const track = pickCaptionTrack(info, this.transcriptLanguage());
    return { track, cues: await this.fetchCues(track), heatmap: info.heatmap };
  }

  /**
   * The phone harvest: the InnerTube player response, which states the caption
   * tracklist on the ANDROID client and hands back a signed, un-IP-locked
   * timedtext URL.
   *
   * No replay peaks here, and that is a limit rather than an oversight: the
   * heatmap lives in the `next` endpoint, whose response for an ordinary video
   * measured over ten megabytes. A phone should not download that to label
   * eight moments. Notes fetched on the Mac still get them, and re-running the
   * command there fills them in for a note the phone made.
   */
  private async harvestWithInnertube(videoId: string): Promise<CaptionHarvest> {
    const track = await fetchCaptionTrack(videoId, this.transcriptLanguage());
    return { track, cues: await this.fetchCues(track), heatmap: undefined };
  }

  /**
   * The caption file itself. Both platforms hand over a signed URL that is
   * immediately valid, so this is one plain request either way — no second
   * yt-dlp call and no temp file.
   */
  private async fetchCues(track: CaptionTrack | null): Promise<Cue[]> {
    if (!track) return [];
    const response = await requestUrl({ url: track.url, throw: true });
    return parseJson3(response.text);
  }

  private transcriptLanguage(): string {
    return this.settings.transcriptLanguage.trim() || "en";
  }

  // ------------------------------------------------------------ description

  /**
   * Rewrite bare `mm:ss` text in a rendered note as seek links.
   *
   * Only runs on notes that name a video, because the seek link needs an ID and
   * a timestamp in an unrelated note is just a number. Text already inside a
   * link, code span or the player chrome is left alone, so stamps written by
   * flow capture — which are real markdown links — pass through untouched.
   */
  private linkifyRendered(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    if (!this.settings.linkifyTimestamps) return;
    const videoId = this.videoIdForNote(ctx.sourcePath);
    if (!videoId) return;

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      // Cheap reject first: this runs over every text node of every note.
      if (!text.nodeValue || !text.nodeValue.includes(":")) continue;
      if (text.parentElement?.closest("a, code, pre, .ytfree-wrapper")) continue;
      targets.push(text);
    }

    for (const node of targets) {
      const value = node.nodeValue ?? "";
      const matches = findTimestamps(value);
      if (matches.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of matches) {
        if (match.index > cursor) {
          fragment.appendChild(document.createTextNode(value.slice(cursor, match.index)));
        }
        const link = document.createElement("a");
        link.className = "ytfree-timestamp-link";
        link.setAttribute("href", `ytfree:${videoId}:${match.seconds}`);
        link.textContent = match.text;
        fragment.appendChild(link);
        cursor = match.index + match.text.length;
      }
      if (cursor < value.length) {
        fragment.appendChild(document.createTextNode(value.slice(cursor)));
      }
      node.parentNode?.replaceChild(fragment, node);
    }
  }

  // -------------------------------------------------------------- download

  /**
   * The local copy of a note's video, or null when there isn't one on this
   * machine — the normal case on a second Mac, where the frontmatter syncs but
   * the file does not. Silence is the correct behaviour there.
   */
  private async localFileFor(path: string | undefined, videoId: string): Promise<string | null> {
    // A phone has no download folder to look in, and `local_media` in synced
    // frontmatter points at a path on the Mac. Streaming is the only answer.
    if (!Platform.isDesktopApp) return null;
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const recorded = this.app.metadataCache.getFileCache(file)?.frontmatter?.[LOCAL_MEDIA_KEY];
    const { resolveLocalFile } = await desktop();
    // Search the folder even with nothing recorded: a file downloaded on this
    // Mac is findable by its [videoId] marker regardless of what the note says.
    return resolveLocalFile(
      typeof recorded === "string" ? recorded : "",
      await this.downloadFolder(),
      videoId,
    );
  }

  /** The configured download folder, or the platform default when it is blank. */
  async downloadFolder(): Promise<string> {
    const configured = this.settings.downloadFolder.trim();
    if (configured) return configured;
    const { defaultDownloadFolder } = await desktop();
    return defaultDownloadFolder();
  }

  private async setLocalMedia(file: TFile, path: string | null): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (path) fm[LOCAL_MEDIA_KEY] = path;
      else delete fm[LOCAL_MEDIA_KEY];
    });
  }

  /** Active note, plus the video it points at. Both are required to download. */
  private activeNoteVideo(): { file: TFile; videoId: string } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) return null;
    const videoId = this.videoIdForNote(file.path);
    return videoId ? { file, videoId } : null;
  }

  private async downloadForActiveNote(): Promise<void> {
    const context = this.activeNoteVideo();
    if (!context) {
      new Notice("YT Free: this note does not point at a YouTube video.");
      return;
    }
    await this.startDownload(context.videoId, context.file);
  }

  /**
   * Download the video, record it in the note, and swap the running player onto
   * the file without interrupting playback.
   */
  private async startDownload(videoId: string, file: TFile): Promise<void> {
    const {
      downloadBaseName,
      downloadVideo,
      ensureDir,
      findFfmpeg,
      formatBytes,
      freeBytes,
      findYtDlp,
      LARGE_FILE_BYTES,
      localFileUrl,
      MIN_FREE_BYTES,
    } = await desktop();

    if (this.downloads.has(videoId)) {
      this.downloads.get(videoId)?.cancel();
      this.downloads.delete(videoId);
      new Notice("YT Free: download cancelled.");
      return;
    }

    const entry = this.players.get(videoId);
    const existing = await this.localFileFor(file.path, videoId);
    if (existing) {
      await this.setLocalMedia(file, existing);
      new Notice("YT Free: already downloaded.");
      entry?.player.setDownloadState("done");
      return;
    }

    const dir = await this.downloadFolder();
    try {
      await ensureDir(dir);
    } catch (err) {
      new Notice(`YT Free: cannot create ${dir} — ${(err as Error).message}`);
      return;
    }

    const free = await freeBytes(dir);
    if (free !== null && free < MIN_FREE_BYTES) {
      new Notice(`YT Free: only ${formatBytes(free)} free. Downloading needs at least 2 GB.`);
      return;
    }

    if (!this.ytDlpPath) {
      try {
        this.ytDlpPath = await findYtDlp(this.settings.ytDlpPath);
      } catch {
        new Notice("YT Free: yt-dlp is not installed, or Obsidian cannot find it.");
        return;
      }
    }

    // Cached across downloads; an ffmpeg install mid-session is rare enough to
    // be worth a plugin reload.
    if (this.ffmpegPath === undefined) {
      this.ffmpegPath = await findFfmpeg(this.settings.ffmpegPath);
    }

    const title =
      (this.app.metadataCache.getFileCache(file)?.frontmatter?.title as string) || file.basename;
    const baseName = downloadBaseName(String(title), videoId);

    let warnedLarge = false;
    const notice = new Notice("YT Free: starting download…", 0);
    entry?.player.setDownloadState("running");

    const handle = downloadVideo({
      videoId,
      ytDlpPath: this.ytDlpPath,
      ffmpegPath: this.ffmpegPath,
      destDir: dir,
      baseName,
      onProgress: (percent, totalBytes) => {
        if (!warnedLarge && totalBytes !== null && totalBytes > LARGE_FILE_BYTES) {
          warnedLarge = true;
          new Notice(`YT Free: this one is ${formatBytes(totalBytes)}.`);
        }
        const size = totalBytes === null ? "" : ` of ${formatBytes(totalBytes)}`;
        notice.setMessage(`YT Free: downloading ${percent.toFixed(1)}%${size} — run the command again to cancel`);
        entry?.player.setDownloadState("running", percent);
      },
    });
    this.downloads.set(videoId, handle);

    try {
      const finalPath = await handle.done;
      await this.setLocalMedia(file, finalPath);
      // Same position, same play state — the swap should be invisible.
      this.players.get(videoId)?.player.swapToLocal(localFileUrl(finalPath));
      entry?.player.setDownloadState("done");
      notice.setMessage(
        this.ffmpegPath
          ? "YT Free: downloaded. This note now plays the local copy."
          : "YT Free: downloaded at 360p — that is the only quality available without ffmpeg. Streaming this note was higher quality. brew install ffmpeg, then re-download.",
      );
    } catch (err) {
      entry?.player.setDownloadState("idle");
      const message = (err as Error).message;
      notice.setMessage(
        message === "cancelled" ? "YT Free: download cancelled." : `YT Free: download failed — ${message}`,
      );
    } finally {
      this.downloads.delete(videoId);
      window.setTimeout(() => notice.hide(), 8000);
    }
  }

  private async deleteLocalCopy(): Promise<void> {
    const context = this.activeNoteVideo();
    if (!context) {
      new Notice("YT Free: this note does not point at a YouTube video.");
      return;
    }
    const local = await this.localFileFor(context.file.path, context.videoId);
    if (!local) {
      await this.setLocalMedia(context.file, null);
      new Notice("YT Free: no local copy on this Mac.");
      return;
    }
    const { removeFile } = await desktop();
    try {
      await removeFile(local);
    } catch (err) {
      new Notice(`YT Free: could not delete the file — ${(err as Error).message}`);
      return;
    }
    await this.setLocalMedia(context.file, null);
    new Notice("YT Free: local copy deleted. This note streams again from now on.");
  }

  /**
   * Mount the player above the note body.
   *
   * Mobile docks instead of floating and reserves its height from the first
   * frame of the mount, before anything is fetched. A draggable panel hovering
   * over a 390pt screen covers the note it belongs to, and a player that grows
   * into place when the stream arrives would push the note text down under the
   * reader's thumb.
   */
  private async mountPinned(view: MarkdownView, videoId: string, sourcePath: string): Promise<void> {
    const mobile = !Platform.isDesktopApp;
    const wrapper = createDiv({
      cls: mobile ? "ytfree-wrapper ytfree-pinned ytfree-docked" : "ytfree-wrapper ytfree-pinned",
    });
    if (!mobile) {
      wrapper.style.setProperty("--ytfree-pinned-height", `${this.settings.pinnedHeightVh}vh`);
    }
    view.contentEl.prepend(wrapper);
    // Marks the view for the CSS that has to override Obsidian's own — see the
    // `.ytfree-has-docked` rules in styles.css. A class beats `:has()` here
    // because it is exact and it is removed the moment the player goes.
    if (mobile) this.holdDockedLayout(view);

    const record: PinnedEntry = { videoId, wrapper, entry: null };
    this.pinned.set(view, record);

    const entry = await this.buildPlayer(wrapper, videoId, sourcePath);

    // The note may have been closed or switched while the stream resolved.
    if (this.pinned.get(view) !== record) {
      entry?.player.destroy();
      if (entry && this.players.get(videoId) === entry) this.players.delete(videoId);
      wrapper.remove();
      return;
    }
    record.entry = entry;
  }

  private unmountPinned(view: MarkdownView): void {
    const record = this.pinned.get(view);
    if (!record) return;
    this.pinned.delete(view);
    if (record.entry) {
      record.entry.player.destroy();
      if (this.players.get(record.videoId) === record.entry) this.players.delete(record.videoId);
    }
    record.wrapper.remove();
    this.releaseDockedLayout(view);
  }

  /**
   * Hold the note body to the height the player left it.
   *
   * The class is what styles.css keys the flex column off. The listener is the
   * belt to its braces: a markdown `.view-content` is `overflow: hidden`, which
   * hides a scrollbar but does not stop iOS from scrolling the box itself to
   * bring the caret into view when the keyboard opens — and once it has, no
   * gesture scrolls it back, so the video stays parked off the top of the
   * screen. Anything that scrolls this container is not the user; undo it.
   */
  private holdDockedLayout(view: MarkdownView): void {
    const el = view.contentEl;
    el.addClass("ytfree-has-docked");
    if (this.dockGuards.has(view)) return;
    const guard = (): void => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };
    el.addEventListener("scroll", guard, { passive: true });
    this.dockGuards.set(view, guard);
  }

  private releaseDockedLayout(view: MarkdownView): void {
    const el = view.contentEl;
    el.removeClass("ytfree-has-docked");
    const guard = this.dockGuards.get(view);
    if (guard) {
      el.removeEventListener("scroll", guard);
      this.dockGuards.delete(view);
    }
  }

  // ---------------------------------------------------------------- capture

  /**
   * The first character typed on a line carries the stamp in with it.
   *
   * Runs on every keystroke, so the cheap line-shape test comes first: it
   * rejects every character after the first one on a line without touching the
   * player, the workspace, or the document as a whole.
   *
   * Returns true only when we replaced the input ourselves. Every other path —
   * including an unexpected throw — returns false, so the keystroke is typed
   * normally. A bug in here must never eat a character.
   */
  private handleInput(view: EditorView, from: number, to: number, text: string): boolean {
    // Pausing hangs off character input, not off document changes. Enter is a
    // keymap command rather than an input, so it never reaches here — which is
    // the point: breaking a line is not typing, and must not stop the video.
    this.handleTyping();

    try {
      if (!this.settings.autoStampNewLine) return false;

      const line = view.state.doc.lineAt(from);
      const offset = stampInsertOffset(line.text, from - line.from, text);
      if (offset === null || from !== to) return false;

      const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const entry = this.playerForPath(mdView?.file?.path);
      if (!entry) return false;

      const ok = shouldAutoStamp({
        enabled: true,
        hasPlayer: true,
        hasPlayed: entry.player.hasPlayed,
        lineText: line.text,
        // Only reached once per line, so scanning the document for fences here
        // is not on the per-keystroke path.
        insideCodeBlock: isInsideCodeBlock(view.state.doc.toString().split("\n"), line.number - 1),
      });
      if (!ok) return false;

      const stamp = this.stampFor(entry);
      view.dispatch({
        changes: { from, to, insert: stamp + text },
        selection: { anchor: from + stamp.length + text.length },
        userEvent: "input.type",
      });
      return true;
    } catch (err) {
      console.error("YT Free: auto-stamp failed; typing the character normally.", err);
      return false;
    }
  }

  /**
   * Typing a character in a note with an active player pauses it, and playback
   * resumes once typing stops. Scope is the whole note, not just the stamped
   * line — but only real character input counts, so Enter (and any programmatic
   * write, such as a sync) leaves playback alone.
   *
   * One shared debounced timer, not one per keystroke.
   */
  private handleTyping(): void {
    try {
      if (!this.settings.pauseWhileTyping) return;

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const entry = this.playerForPath(view?.file?.path);
      if (!entry) return;

      entry.player.pauseForTyping();

      this.clearResumeTimer();
      this.resumeTimer = window.setTimeout(() => {
        this.resumeTimer = null;
        entry.player.resumeAfterTyping();
      }, Math.max(0, this.settings.resumeIdleMs));
    } catch (err) {
      console.error("YT Free: pause-while-typing failed.", err);
    }
  }

  private clearResumeTimer(): void {
    if (this.resumeTimer !== null) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
  }

  /** Playback position shifted back by the lookback offset. */
  private captureSeconds(player: YtFreePlayer): number {
    return applyLookback(player.currentTime, this.settings.lookbackSeconds);
  }

  /**
   * The displayed time and the seek target are deliberately different numbers.
   *
   * `{ts}` shows where you were when you wrote the line, because that is the
   * moment you are looking for when you scan the note later. `{link}` points
   * `lookbackSeconds` earlier, so clicking it drops you in slightly before the
   * thing rather than just after it. Reading and replaying want different
   * answers, so they get different answers.
   */
  /**
   * Seek the named player, claiming the user gesture first. Shared by the
   * Reading-view anchor handler and the Live Preview editor handler.
   */
  private followSeekLink(videoId: string, seconds: number): void {
    const entry = this.players.get(videoId);
    if (!entry) {
      new Notice("YT Free: that video is not open in this note.");
      return;
    }
    this.lastActiveVideoId = videoId;

    // Claim the tap now, synchronously. On mobile the player may still have
    // to resolve a URL, and by the time that returns iOS no longer counts
    // this as a user gesture — so the element has to be touched first.
    entry.player.primeForGesture();
    void this.seekEntry(entry, seconds);
  }

  /**
   * The seekable link under a mouse event in Live Preview, or null.
   *
   * Null in source mode, and null when the selection already touches the link
   * — there Obsidian shows the raw markdown, and a click should place the
   * cursor, not seek. This runs at mousedown, before CodeMirror moves the
   * selection to the click, because "was the user editing this link?" is a
   * question about the state before the click.
   */
  private editorSeekLinkAt(
    at: { clientX: number; clientY: number },
    view: EditorView,
    guardSelection: boolean,
  ): { videoId: string; seconds: number } | null {
    if (!view.state.field(editorLivePreviewField, false)) return null;
    const pos = view.posAtCoords({ x: at.clientX, y: at.clientY });
    if (pos === null) return null;

    const line = view.state.doc.lineAt(pos);
    const link = seekLinkAt(line.text, pos - line.from);
    if (!link) return null;

    if (guardSelection) {
      const linkFrom = line.from + link.from;
      const linkTo = line.from + link.to;
      for (const range of view.state.selection.ranges) {
        if (range.from <= linkTo && range.to >= linkFrom) return null;
      }
    }
    return { videoId: link.videoId, seconds: link.seconds };
  }

  /** Timestamp clicks in Live Preview, armed by the matching mousedown. */
  private handleEditorClick(evt: MouseEvent, view: EditorView): boolean {
    const armed = this.armedSeekLink;
    this.armedSeekLink = null;
    if (!armed) return false;

    // The click must still land on the same link — a drag that started on it
    // is a text selection, not a click. No selection guard here: by click
    // time CodeMirror may already have moved the cursor into the link.
    const now = this.editorSeekLinkAt(evt, view, false);
    if (!now || now.videoId !== armed.videoId || now.seconds !== armed.seconds) {
      return false;
    }

    evt.preventDefault();
    evt.stopPropagation();
    this.followSeekLink(armed.videoId, armed.seconds);
    return true;
  }

  private timestampText(videoId: string, displaySeconds: number, seekSeconds: number): string {
    return this.settings.timestampFormat
      .replace("{ts}", formatTimestamp(displaySeconds))
      .replace("{link}", `ytfree:${videoId}:${seekSeconds}`)
      .replace("{seconds}", String(seekSeconds));
  }

  /** Build a stamp from a player's current position. */
  private stampFor(entry: PlayerEntry): string {
    const display = Math.floor(entry.player.currentTime);
    return this.timestampText(entry.videoId, display, this.captureSeconds(entry.player));
  }

  /**
   * Used by the player's Timestamp button, which has no editor of its own.
   * Falls back to a Notice rather than failing silently when the note is in
   * Reading view, where there is no cursor to write to.
   */
  private insertTimestampFromButton(videoId: string, seconds: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor;
    if (!editor || view?.getMode() !== "source") {
      new Notice("YT Free: switch to editing view to insert a timestamp.");
      return;
    }
    this.lastActiveVideoId = videoId;
    // Lookback applies here too, so all three capture paths agree.
    editor.replaceSelection(
      this.timestampText(videoId, seconds, applyLookback(seconds, this.settings.lookbackSeconds)),
    );
  }

  /** The player belonging to a specific note, or null. Never a fallback. */
  private playerForPath(path: string | undefined): PlayerEntry | null {
    if (!path) return null;
    if (this.lastActiveVideoId) {
      const entry = this.players.get(this.lastActiveVideoId);
      if (entry && entry.sourcePath === path) return entry;
    }
    for (const entry of this.players.values()) {
      if (entry.sourcePath === path) return entry;
    }
    return null;
  }

  /**
   * Loosest lookup, used only by the explicit command, where the user has asked
   * for a timestamp and a Notice saying "no player" is worse than guessing.
   */
  private anyPlayer(): PlayerEntry | null {
    if (this.lastActiveVideoId) {
      const entry = this.players.get(this.lastActiveVideoId);
      if (entry) return entry;
    }
    const first = this.players.values().next();
    return first.done ? null : first.value;
  }

  private async renderBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<void> {
    const videoId = extractVideoId(source);

    // A pinned player is already showing this video at the top of the note.
    // Rendering a second one would fight it for the timestamp keying and buffer
    // the same stream twice, so the fence stands down and says so.
    if (videoId && this.pinnedVideoIdFor(ctx.sourcePath) === videoId) {
      const note = el.createDiv({ cls: "ytfree-pinned-stub" });
      note.setText("▲ Playing in the pinned player at the top of this note.");
      return;
    }

    const wrapper = el.createDiv({ cls: "ytfree-wrapper" });
    if (!videoId) {
      this.renderError(wrapper, "Not a YouTube URL or video ID.", source.trim());
      return;
    }

    const entry = await this.buildPlayer(wrapper, videoId, ctx.sourcePath);
    if (!entry) return;

    // Tear the player down when the note or preview pane closes, so no stream
    // keeps buffering in the background.
    const self = this;
    ctx.addChild(
      new (class extends MarkdownRenderChild {
        onunload(): void {
          entry.player.destroy();
          if (self.players.get(videoId) === entry) self.players.delete(videoId);
        }
      })(wrapper),
    );
  }

  /**
   * Build, register and load a player inside `wrapper`. Shared by the fenced
   * block and the pinned player so the two can never drift apart — same
   * controls, same recovery, same error text.
   *
   * Returns null when the stream could not be resolved; the error is already
   * rendered into the wrapper by then.
   */
  private async buildPlayer(
    wrapper: HTMLElement,
    videoId: string,
    sourcePath: string,
  ): Promise<PlayerEntry | null> {
    const mobile = !Platform.isDesktopApp;

    // Mobile keeps the media in its own fixed-aspect box, so the poster, the
    // video and the fallback all occupy exactly the same space and swapping
    // between them moves nothing.
    const media = mobile ? wrapper.createDiv({ cls: "ytfree-media" }) : wrapper;

    // Desktop: a reserved, fixed-height row, so showing or clearing a status
    // message never shifts the player or the note content around it.
    //
    // Mobile: the same element, but *inside* the media box and drawn over the
    // top of the picture. A reserved line above the video is a line of the note
    // you never get to read, and the messages it carries are transient. It
    // still costs no layout, for a better reason than before — it is out of
    // the flow entirely.
    const status = (mobile ? media : wrapper).createDiv({ cls: "ytfree-status" });
    const setStatus = (message: string | null) => {
      status.setText(message ?? "");
      status.toggleClass("ytfree-status-visible", message !== null);
    };

    const provider = mobile
      ? this.mobileProvider(videoId)
      : this.desktopProvider(videoId);

    const noteFile = this.app.vault.getAbstractFileByPath(sourcePath);
    const player = new YtFreePlayer(
      wrapper,
      provider,
      setStatus,
      // No timestamp button on a phone: stamps arrive through flow capture as
      // you type, and reaching for a button means the keyboard is already up
      // and the note is already where the cursor is.
      mobile ? undefined : (seconds) => this.insertTimestampFromButton(videoId, seconds),
      // Downloading needs yt-dlp, so the button is desktop-only. A note file is
      // also required — there is nowhere to record the path without one.
      !mobile && noteFile instanceof TFile
        ? () => void this.startDownload(videoId, noteFile)
        : undefined,
      {
        mediaHost: media,
        onToggleCollapse: mobile ? () => this.toggleCollapse(videoId) : undefined,
        // Reads `activate` at call time, not now: the lazy loader is attached
        // further down, after this player exists.
        ensureLoaded: mobile
          ? () => this.players.get(videoId)?.activate?.() ?? Promise.resolve()
          : undefined,
        // Only where there is a note to jump around in. A fenced block rendered
        // outside a file — a preview, an export — has no sections.
        onJump:
          noteFile instanceof TFile
            ? (section) => this.jumpToSection(noteFile, section)
            : undefined,
        // Where you got to last time, and where you are getting to now. Read
        // through the store on each call rather than captured once, so a video
        // open in two panes agrees with itself.
        resumeAt: () => this.progress.resumeFor(videoId),
        onProgress: (seconds, duration) => this.progress.record(videoId, seconds, duration),
      },
    );
    const entry: PlayerEntry = {
      player,
      videoId,
      sourcePath,
      wrapper,
      collapsed: null,
      activate: null,
    };
    this.players.set(videoId, entry);
    player.video.addEventListener("play", () => {
      this.lastActiveVideoId = videoId;
    });

    // A present local copy wins: no yt-dlp, no expiry, instant first frame.
    const localFile = await this.localFileFor(sourcePath, videoId);
    if (localFile) {
      const { localFileUrl } = await desktop();
      player.setDownloadState("done");
      player.loadLocal(localFileUrl(localFile), () => {
        // Corrupt file, unmounted volume, truncated download. Say so once, then
        // fall back to the network rather than showing a dead player.
        setStatus("Local copy could not be played — streaming instead.");
        window.setTimeout(() => setStatus(null), 6000);
        void player.load(this.settings.upgradeToHighQuality).catch(() => undefined);
      });
      this.announceResume(videoId, setStatus);
      return entry;
    }

    if (mobile) {
      this.deferMobileLoad(entry, media, setStatus);
      return entry;
    }

    setStatus("Resolving stream…");
    try {
      await player.load(this.settings.upgradeToHighQuality);
      this.announceResume(videoId, setStatus);
      return entry;
    } catch (err) {
      player.destroy();
      this.players.delete(videoId);
      if (err instanceof YtDlpMissingError) {
        this.renderError(
          wrapper,
          "yt-dlp is not installed, or Obsidian cannot find it.",
          "brew install yt-dlp",
        );
      } else {
        this.renderError(
          wrapper,
          "Could not resolve this video. YouTube may have changed extraction — updating yt-dlp usually fixes it.",
          `brew upgrade yt-dlp\n\n${(err as Error).message}`,
        );
      }
      return null;
    }
  }

  /**
   * Say where a resumed video picked up from — then get out of the way.
   *
   * Silence would be worse than wrong: a video that opens at 12:34 with no
   * explanation looks like a bug, and the first thing you would do is drag the
   * scrubber back to the start to find out why. One line for six seconds in the
   * status row that is already reserved costs no layout and answers it.
   */
  private announceResume(videoId: string, setStatus: (message: string | null) => void): void {
    const seconds = this.progress.resumeFor(videoId);
    if (seconds <= 0) {
      setStatus(null);
      return;
    }
    setStatus(`Picking up at ${formatTimestamp(seconds)}`);
    window.setTimeout(() => setStatus(null), 6000);
  }

  /** yt-dlp, via the stream cache. Desktop only. */
  private desktopProvider(videoId: string): (m: ResolveMode, f: boolean) => Promise<ResolvedStream> {
    return async (mode, forceRefresh) => {
      if (forceRefresh) this.cache.invalidate(videoId);
      const cached = this.cache.get(videoId, mode);
      if (cached) return cached;

      const { findYtDlp, resolveStream } = await desktop();
      if (!this.ytDlpPath) {
        this.ytDlpPath = await findYtDlp(this.settings.ytDlpPath);
      }
      const stream = await resolveStream(videoId, this.ytDlpPath, mode);
      this.cache.set(videoId, stream);
      return stream;
    };
  }

  /**
   * InnerTube, via the same cache. Mobile only.
   *
   * The mode is ignored: 360p is all this resolver can reach, so asking for
   * "quality" would only mean resolving the same thing twice.
   */
  private mobileProvider(videoId: string): (m: ResolveMode, f: boolean) => Promise<ResolvedStream> {
    return async (_mode, forceRefresh) => {
      if (forceRefresh) this.cache.invalidate(videoId);
      const cached = this.cache.get(videoId, "fast");
      if (cached) return cached;

      const { resolveMobileStream } = await import("./mobile/innertube.ts");
      const stream = await resolveMobileStream(videoId);
      this.cache.set(videoId, stream);
      return stream;
    };
  }

  /**
   * Mobile: mount now, resolve later.
   *
   * Opening a note should not cost a video. The player takes up its final space
   * immediately and shows a poster; the stream is fetched the first time
   * something asks to play — a tap on the poster, or a tapped timestamp.
   */
  private deferMobileLoad(
    entry: PlayerEntry,
    media: HTMLElement,
    setStatus: (message: string | null) => void,
  ): void {
    const { player, videoId } = entry;

    // Absolutely positioned over the media box, so adding and removing it
    // cannot affect the layout of anything.
    const poster = media.createEl("button", { cls: "ytfree-poster", attr: { type: "button" } });
    const thumb = poster.createEl("img", { cls: "ytfree-poster-image", attr: { alt: "" } });
    thumb.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    poster.createDiv({ cls: "ytfree-poster-play", text: "▶" });

    // The phone never shows the desktop's status line before you tap, so the
    // resume point is written on the poster instead: you know before playing
    // that this one starts part-way in, rather than being surprised by it.
    const resumeAt = this.progress.resumeFor(videoId);
    if (resumeAt > 0) {
      poster.createDiv({
        cls: "ytfree-poster-resume",
        text: `Resume ${formatTimestamp(resumeAt)}`,
      });
    }

    let started: Promise<void> | null = null;

    const activate = (): Promise<void> => {
      if (started) return started;
      poster.disabled = true;
      setStatus("Resolving stream…");
      started = player
        .load(false)
        .then(() => {
          poster.remove();
          media.querySelector(".ytfree-fallback")?.remove();
          setStatus(null);
          player.play();
        })
        .catch((err: unknown) => {
          // Reset, so a failure caused by a dead connection can be tried again.
          // The retry has to be a control inside the fallback: the fallback
          // covers the media box, and therefore covers the poster underneath.
          started = null;
          poster.disabled = false;
          setStatus(null);
          this.renderMobileFallback(media, entry, err, () => {
            player.primeForGesture();
            void activate();
          });
        });
      return started;
    };

    entry.activate = activate;
    poster.addEventListener("click", () => {
      // Same reason as the timestamp handler: claim the gesture before the
      // resolve throws it away.
      player.primeForGesture();
      void activate();
    });
  }

  /**
   * Seek, resolving the stream first if it has not been fetched yet.
   *
   * On desktop `activate` is null and this is the plain seek it always was.
   */
  private async seekEntry(entry: PlayerEntry, seconds: number): Promise<void> {
    if (entry.activate) {
      this.pendingSeek.set(entry.videoId, seconds);
      await entry.activate();
    }
    entry.player.seekWhenReady(seconds);
  }

  /**
   * The one control a failed resolve must always show.
   *
   * A dead player with no explanation is the worst outcome here, and retrying
   * in a loop is the second worst. The link carries the timestamp that was
   * tapped, so the fallback lands where the note pointed rather than at 0:00.
   */
  private renderMobileFallback(
    media: HTMLElement,
    entry: PlayerEntry,
    err: unknown,
    retry: () => void,
  ): void {
    media.querySelector(".ytfree-fallback")?.remove();

    const seconds = this.pendingSeek.get(entry.videoId) ?? 0;
    const kind = (err as { kind?: string })?.kind;
    const detail =
      kind === "login"
        ? "This video needs a signed-in account — age-restricted or members-only."
        : kind === "network"
          ? "Could not reach YouTube. Check your connection and try again."
          : kind === "no-format"
            ? "YouTube offered no single-file format for this video."
            : `Could not resolve this video. ${err instanceof Error ? err.message : String(err)}`;

    const box = media.createDiv({ cls: "ytfree-fallback" });
    box.createDiv({ cls: "ytfree-fallback-text", text: detail });

    const actions = box.createDiv({ cls: "ytfree-fallback-actions" });
    const link = actions.createEl("a", {
      cls: "ytfree-fallback-link",
      text: seconds > 0 ? `Open in YouTube at ${formatTimestamp(seconds)}` : "Open in YouTube",
    });
    link.href = seconds > 0
      ? `https://youtu.be/${entry.videoId}?t=${seconds}`
      : `https://youtu.be/${entry.videoId}`;
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener");

    // Only worth offering when trying again could plausibly work. A removed or
    // age-restricted video will fail identically every time, and a button that
    // is guaranteed to fail is worse than no button.
    if (kind === "network") {
      const again = actions.createEl("button", {
        cls: "ytfree-fallback-retry",
        text: "Try again",
        attr: { type: "button" },
      });
      again.addEventListener("click", () => {
        box.remove();
        retry();
      });
    }
  }

  /**
   * Mobile's close control: unmount the docked player and give the space back
   * in one step.
   *
   * The dismissal has to be recorded, because the very next `layout-change`
   * would otherwise read the same frontmatter and mount it straight back. It is
   * remembered per view and per note, the same way collapsed properties are, so
   * navigating away and back brings the player with you.
   */
  /**
   * Hide the picture, keep the player.
   *
   * Collapsing used to tear the player down and leave a "Show video" bar, which
   * lost the reader's place in the video every time. Now only the media box
   * loses its height: the element stays mounted, so the position, the buffer
   * and any audio are all exactly where they were, and coming back is instant.
   * Collapsing by hand also pauses — you are putting the video away.
   */
  private toggleCollapse(videoId: string): void {
    const entry = this.players.get(videoId);
    if (!entry) return;
    if (entry.collapsed) {
      this.setCollapsed(entry, null);
      return;
    }
    entry.player.pause();
    this.setCollapsed(entry, "manual");
  }

  private setCollapsed(entry: PlayerEntry, mode: CollapseMode): void {
    entry.collapsed = mode;
    entry.wrapper.toggleClass("is-collapsed", mode !== null);
    entry.wrapper.toggleClass("is-collapsed-keyboard", mode === "keyboard");
    entry.player.setCollapsed(mode !== null);
  }

  /**
   * The keyboard takes the video's space, and gives it back.
   *
   * Editing a note on a phone with a 16:9 player docked above it left about two
   * lines of text visible between the video and the keyboard. So the video
   * folds away the moment the editor takes focus and unfolds when the keyboard
   * goes — without pausing, which is the point: pause-while-typing and its idle
   * resume go on working underneath, so the audio comes back on its own after
   * two seconds and the video stays out of the way until you are done.
   *
   * A collapse the reader asked for is not touched by any of this.
   */
  private collapseForKeyboard(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const entry = this.playerForPath(view?.file?.path);
    if (!entry || entry.collapsed) return;
    this.setCollapsed(entry, "keyboard");
  }

  private releaseKeyboardCollapse(): void {
    for (const entry of this.players.values()) {
      if (entry.collapsed === "keyboard") this.setCollapsed(entry, null);
    }
  }

  /**
   * Is the on-screen keyboard up?
   *
   * Obsidian keeps `--keyboard-height` on the document element and animates it,
   * so it is the app's own answer rather than our guess. The visual viewport is
   * the fallback for the case where that variable never arrives.
   */
  private keyboardIsOpen(): boolean {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue("--keyboard-height")
      .trim();
    const height = Number.parseFloat(raw);
    if (Number.isFinite(height) && raw !== "") return height > 1;

    const vv = window.visualViewport;
    return vv ? window.innerHeight - vv.height > 120 : false;
  }

  private renderError(parent: HTMLElement, message: string, detail: string): void {
    parent.empty();
    const box = parent.createDiv({ cls: "ytfree-error" });
    box.createEl("strong", { text: "YT Free" });
    box.createEl("p", { text: message });
    if (detail) box.createEl("pre", { text: detail });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Full rebuild, used when a setting changed the shape of the pinned player
   * rather than which video it shows. Costs a re-resolve, but the stream cache
   * usually makes that free, and settings changes are rare.
   */
  refreshPinnedPlayers(): void {
    for (const view of [...this.pinned.keys()]) this.unmountPinned(view);
    this.syncPinnedPlayers();
  }

  /** Absolute path of the vault on disk, or null on a non-file adapter. */
  vaultPath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  resetFfmpeg(): void {
    this.ffmpegPath = undefined;
  }

  resetResolver(): void {
    this.ytDlpPath = null;
    this.cache.clear();
  }

  /** The yt-dlp binary, probed once and remembered until a setting changes it. */
  private async resolveYtDlp(): Promise<string> {
    if (this.ytDlpPath) return this.ytDlpPath;
    const { findYtDlp } = await desktop();
    this.ytDlpPath = await findYtDlp(this.settings.ytDlpPath);
    return this.ytDlpPath;
  }
}

class YtFreeSettingTab extends PluginSettingTab {
  /**
   * The account status line and its button, kept so a sync finishing can update
   * them in place. Redrawing the whole tab would move everything under the
   * pointer for a line of text that changed.
   */
  private accountStatusEl: HTMLElement | null = null;
  private accountButtonEl: HTMLElement | null = null;

  constructor(app: App, private plugin: YtFreePlugin) {
    super(app, plugin);
  }

  /** Called when a sign-in or a sync changes the session. */
  refresh(): void {
    const session = this.plugin.settings.accountSession;
    this.accountStatusEl?.setText(describeSession(session, new Date()));
    this.accountButtonEl?.setText(session.status === "signed-out" ? "Sign in…" : "Sign out");
  }

  hide(): void {
    this.accountStatusEl = null;
    this.accountButtonEl = null;
  }

  /**
   * The signed-in section. Deliberately blunt about what it stores: what a
   * sign-in captures is a live Google session, not a scoped token, and someone
   * who has that file can act as this account anywhere until it is signed out.
   */
  private displayAccount(containerEl: HTMLElement): void {
    const plugin = this.plugin;
    new Setting(containerEl).setName("YouTube account").setHeading();

    const account = new Setting(containerEl)
      .setName("Sign in to YouTube")
      .setDesc(
        "Fills the hub from your real account — subscriptions, Watch Later, and what you have already watched. " +
          "You type into Google's own page; the plugin never sees your password. " +
          "Playback stays signed out, so nothing you watch here is added to your YouTube history.",
      );

    // Its own line, with reserved height, so the status changing from “Not
    // signed in” to a name and a sync time never moves the rows below it.
    this.accountStatusEl = account.descEl.createDiv({ cls: "ytfree-account-status" });
    this.accountStatusEl.setText(describeSession(plugin.settings.accountSession, new Date()));

    account.addButton((button) => {
      // Fixed width: the label swaps between “Sign in…” and “Sign out”, and a
      // button that resizes itself would shove its neighbour sideways.
      button.buttonEl.addClass("ytfree-account-button");
      this.accountButtonEl = button.buttonEl;
      button
        .setButtonText(plugin.settings.accountSession.status === "signed-out" ? "Sign in…" : "Sign out")
        .onClick(() => {
          if (plugin.settings.accountSession.status === "signed-out") void plugin.signIn();
          else void plugin.signOut();
        });
    });

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc(
        "Pull subscriptions, Watch Later and history immediately, then check the channel feeds. " +
          "The sync button in the hub runs exactly this.",
      )
      .addButton((button) => button.setButtonText("Sync").onClick(() => void plugin.syncNow()));

    new Setting(containerEl)
      .setName("Sync every")
      .setDesc(
        "Hours between authenticated syncs. yt-dlp warns that frequent authenticated requests can get an account flagged, " +
          "so this is a floor rather than a target — leave it high unless you have a reason.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 48, 1)
          .setValue(plugin.settings.accountSyncHours)
          .setDynamicTooltip()
          .onChange(async (value) => {
            plugin.settings.accountSyncHours = value;
            await plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("History depth")
      .setDesc(
        "How many recent videos of your watch history to read each sync, to mark things you have already seen. " +
          "History is read-only — nothing here ever writes to it.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(50, 1000, 50)
          .setValue(plugin.settings.accountHistoryLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            plugin.settings.accountHistoryLimit = value;
            await plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Show watched videos in New")
      .setDesc(
        "Off by default: a video you already watched on your phone or TV drops out of the Inbox. It stays in Everything and Kept either way.",
      )
      .addToggle((toggle) =>
        toggle.setValue(plugin.settings.accountShowWatched).onChange(async (value) => {
          plugin.settings.accountShowWatched = value;
          await plugin.saveSettings();
          plugin.refreshHub();
        }),
      );

    new Setting(containerEl)
      .setName("Session file")
      .setDesc(
        "Where the signed-in session is kept, in the format yt-dlp reads. Blank means ~/Library/Application Support/obsidian-ytfree/cookies.txt. " +
          "Kept outside the vault on purpose: this file is a live Google session — full access to the account, not a limited token — and the vault syncs through iCloud. " +
          "Treat it like a password, and sign out to delete it.",
      )
      .addText((text) =>
        text
          .setPlaceholder("~/Library/Application Support/obsidian-ytfree/cookies.txt")
          .setValue(plugin.settings.accountCookieFile)
          .onChange(async (value) => {
            plugin.settings.accountCookieFile = value.trim();
            await plugin.saveSettings();
          }),
      );
  }

  display(): void {
    const { containerEl } = this;
    const desktopApp = Platform.isDesktopApp;
    containerEl.empty();

    if (desktopApp) {
      new Setting(containerEl)
        .setName("yt-dlp path")
        .setDesc("Leave blank to auto-detect. Obsidian does not inherit your shell PATH, so a full path may be needed.")
        .addText((text) =>
          text
            .setPlaceholder("/opt/homebrew/bin/yt-dlp")
            .setValue(this.plugin.settings.ytDlpPath)
            .onChange(async (value) => {
              this.plugin.settings.ytDlpPath = value.trim();
              this.plugin.resetResolver();
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Upgrade to high quality")
        .setDesc(
          "Video always starts fast at 360p, then silently upgrades to 1080p once the higher-quality stream resolves (about 30 seconds). Turn off to stay at 360p and save bandwidth.",
        )
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.upgradeToHighQuality).onChange(async (value) => {
            this.plugin.settings.upgradeToHighQuality = value;
            await this.plugin.saveSettings();
          }),
        );
    } else {
      // Saying this once, plainly, beats a mobile user wondering why the
      // picture is soft and where the download button went.
      new Setting(containerEl)
        .setName("On this device")
        .setDesc(
          "Playback here resolves the stream in the plugin and plays it in a normal video element — ad-free, at 360p. " +
            "Transcripts work here too, read straight off YouTube. " +
            "Quality above 360p, downloading, and the most-replayed list all need yt-dlp, which only exists on the desktop app — " +
            "open the note on the Mac and run the transcript command again to add the replay peaks.",
        );
    }

    new Setting(containerEl)
      .setName("Timestamp format")
      .setDesc(
        "Placeholders: {ts} the time you wrote the line, {link} seek link, {seconds} raw seek seconds. {ts} shows where you were; {link} and {seconds} point Lookback seconds earlier, so clicking lands just before it.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.timestampFormat)
          .onChange(async (value) => {
            this.plugin.settings.timestampFormat = value;
            await this.plugin.saveSettings();
          }),
      );

    // Signing in needs an Electron webview and yt-dlp, neither of which exists
    // on a phone. The whole section would be controls for something that cannot
    // happen there.
    if (desktopApp) this.displayAccount(containerEl);

    new Setting(containerEl).setName("Subscriptions hub").setHeading();

    new Setting(containerEl)
      .setName("Import subscriptions")
      .setDesc(
        "Google Takeout → YouTube and YouTube Music → subscriptions only. Importing again later adds new channels and removes nothing.",
      )
      .addButton((button) =>
        button
          .setButtonText("Import…")
          .onClick(() =>
            new ImportSubscriptionsModal(this.app, this.plugin.subscriptions, () =>
              this.plugin.refreshHub(),
            ).open(),
          ),
      );

    new Setting(containerEl)
      .setName("New-note folder")
      .setDesc("Where clicking a video in the hub puts its note.")
      .addText((text) =>
        text
          .setPlaceholder("Watch Later")
          .setValue(this.plugin.settings.watchLaterFolder)
          .onChange(async (value) => {
            this.plugin.settings.watchLaterFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Check every")
      .setDesc(
        "Minutes between checks, plus once when Obsidian starts. A channel feed only holds its last 15 videos, so a long gap between checks can lose the oldest of a burst for good.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(15, 360, 15)
          .setValue(this.plugin.settings.subscriptionsPollMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.subscriptionsPollMinutes = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Forget unwatched videos after")
      .setDesc(
        "Days. Measured from the publish date. Only videos you never clicked are removed, and only from the hub — this never deletes a note. Zero keeps everything.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 180, 5)
          .setValue(this.plugin.settings.subscriptionsExpiryDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.subscriptionsExpiryDays = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Include Shorts")
      .setDesc(
        "The feed mixes Shorts with normal videos and marks neither, so each new video is checked once to tell them apart. Off by default.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.subscriptionsIncludeShorts).onChange(async (value) => {
          this.plugin.settings.subscriptionsIncludeShorts = value;
          await this.plugin.saveSettings();
          this.plugin.refreshHub();
        }),
      );

    // Downloading needs yt-dlp and a filesystem, so on mobile this whole
    // section would only be settings for something that cannot happen.
    if (desktopApp) {
      new Setting(containerEl).setName("Offline downloads").setHeading();

      const folderSetting = new Setting(containerEl)
        .setName("Download folder")
        .addText((text) =>
          text
            .setPlaceholder("~/Movies/YT Free")
            .setValue(this.plugin.settings.downloadFolder)
            .onChange(async (value) => {
              // Blank stays blank and means the default — which cannot be
              // spelled out in the defaults, because it needs `os.homedir()`.
              this.plugin.settings.downloadFolder = value.trim();
              await this.plugin.saveSettings();
              describeFolder();
            }),
        );

      // A path inside the vault is the one mistake here that is expensive and
      // hard to undo, because the vault syncs. Say so at the moment it is made.
      const describeFolder = () => {
        const vaultPath = this.plugin.vaultPath();
        const chosen = this.plugin.settings.downloadFolder.trim();
        const inVault = Boolean(chosen) && Boolean(vaultPath) && chosen.startsWith(vaultPath as string);
        folderSetting.setDesc(
          inVault
            ? "⚠ This folder is inside your vault. Downloads will sync to every device and count against iCloud storage. Pick somewhere outside the vault."
            : "Where downloaded videos are kept. Blank means ~/Movies/YT Free. Outside the vault on purpose — these files are a local cache, not vault content.",
        );
      };
      describeFolder();

      new Setting(containerEl)
        .setName("ffmpeg path")
        .setDesc(
          "Leave blank to auto-detect. Required for downloads above 360p: YouTube only serves one pre-muxed format (itag 18, 360p) and everything better needs ffmpeg to merge separate video and audio. Streaming is unaffected — that reaches 1080p without ffmpeg.",
        )
        .addText((text) =>
          text
            .setPlaceholder("/opt/homebrew/bin/ffmpeg")
            .setValue(this.plugin.settings.ffmpegPath)
            .onChange(async (value) => {
              this.plugin.settings.ffmpegPath = value.trim();
              this.plugin.resetFfmpeg();
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl).setName("Pinned player").setHeading();

    new Setting(containerEl)
      .setName("Pin the player to the top of the note")
      .setDesc(
        "When a note's frontmatter points at a YouTube video, the full player — controls, speed, PiP, timestamp — is mounted above the note body and stays there while you scroll. A ```ytfree block for the same video steps aside so you never get two players.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pinnedPlayer).onChange(async (value) => {
          this.plugin.settings.pinnedPlayer = value;
          await this.plugin.saveSettings();
          this.plugin.refreshPinnedPlayers();
        }),
      );

    new Setting(containerEl)
      .setName("Frontmatter properties")
      .setDesc("Comma-separated, tried in order. The first one holding a YouTube URL wins.")
      .addText((text) =>
        text
          .setPlaceholder("media_link, url")
          .setValue(this.plugin.settings.pinnedFrontmatterKeys)
          .onChange(async (value) => {
            this.plugin.settings.pinnedFrontmatterKeys = value;
            await this.plugin.saveSettings();
            this.plugin.refreshPinnedPlayers();
          }),
      );

    new Setting(containerEl)
      .setName("Pinned player height")
      .setDesc("Percent of the window height. Fixed, so the note text below never moves.")
      .addSlider((slider) =>
        slider
          .setLimits(20, 70, 5)
          .setValue(this.plugin.settings.pinnedHeightVh)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pinnedHeightVh = value;
            await this.plugin.saveSettings();
            this.plugin.refreshPinnedPlayers();
          }),
      );

    new Setting(containerEl)
      .setName("Collapse properties on video notes")
      .setDesc(
        "Fold the properties table when you open a note whose frontmatter names a video, so the player and your notes start at the top. Expanding it by hand sticks until you open another note.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.collapseProperties).onChange(async (value) => {
          this.plugin.settings.collapseProperties = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Collapse description and transcript")
      .setDesc(
        "Open a video note with Notes showing and the description, transcript and most-replayed sections folded. Unfolding one sticks until you open another note.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.collapseSections).onChange(async (value) => {
          this.plugin.settings.collapseSections = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Link timestamps in the note body")
      .setDesc(
        "Render bare times like 1:02:03 — the chapter list in a pasted description — as clickable seek links. Only on notes that name a video.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.linkifyTimestamps).onChange(async (value) => {
          this.plugin.settings.linkifyTimestamps = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Transcript").setHeading();

    new Setting(containerEl)
      .setName("Fetch automatically for new notes")
      .setDesc(
        "Notes created this session — from the template, the Web Clipper, or a tap in the hub — get their transcript without being asked, on the phone as well as the Mac. Replay peaks are added on the Mac only. Opening an older note never triggers it; use the command for those.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoFetchTranscript).onChange(async (value) => {
          this.plugin.settings.autoFetchTranscript = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Section length")
      .setDesc(
        "How much transcript sits under each seek link. Shorter means more precise links and a longer note. Timestamps land on real caption starts, so a section is never exactly this long.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(15, 180, 15)
          .setValue(this.plugin.settings.transcriptIntervalSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.transcriptIntervalSeconds = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Most-replayed moments")
      .setDesc(
        "How many replay peaks to list above the transcript, labelled with what is being said there. Zero turns the section off.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 1)
          .setValue(this.plugin.settings.heatmapPeaks)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.heatmapPeaks = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Caption language")
      .setDesc(
        "Language code to look for. Uploader-written captions are preferred over auto-generated ones when both exist.",
      )
      .addText((text) =>
        text
          .setPlaceholder("en")
          .setValue(this.plugin.settings.transcriptLanguage)
          .onChange(async (value) => {
            this.plugin.settings.transcriptLanguage = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Flow capture").setHeading();

    new Setting(containerEl)
      .setName("Timestamp every new line")
      .setDesc(
        "Once a video in the note has been played, the first character you type on a line brings its timestamp in with it. Works on the first line of a note, and whether the video is playing or paused. Turn off to use the command or the Timestamp button instead.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStampNewLine).onChange(async (value) => {
          this.plugin.settings.autoStampNewLine = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Lookback")
      .setDesc(
        "How far before the moment you wrote a line its timestamp link should land, because you decide something is worth noting after you hear it. The timestamp still displays the time you wrote at — only the click target moves back. Applies to auto-stamps, the command, and the Timestamp button.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 30, 1)
          .setValue(this.plugin.settings.lookbackSeconds)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.lookbackSeconds = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Pause while typing")
      .setDesc(
        "Typing anywhere in a note with an active video pauses playback, so you never fall behind mid-sentence. A video you paused yourself is never resumed.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.pauseWhileTyping).onChange(async (value) => {
          this.plugin.settings.pauseWhileTyping = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Resume after")
      .setDesc("Milliseconds of no typing before playback starts again.")
      .addSlider((slider) =>
        slider
          .setLimits(250, 5000, 250)
          .setValue(this.plugin.settings.resumeIdleMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.resumeIdleMs = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
