import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  App,
  FileSystemAdapter,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  requestUrl,
  Setting,
  TFile,
} from "obsidian";
import {
  applyLookback,
  isInsideCodeBlock,
  shouldAutoStamp,
  stampInsertOffset,
} from "./capture";
import type { DownloadHandle } from "./desktop/download.ts";
import { findTimestamps } from "./description";
import { formatTimestamp } from "./format";
import {
  HUB_VIEW_TYPE,
  HubSettings,
  HubView,
  ImportSubscriptionsModal,
  SubscriptionsStore,
} from "./hub";
import type { Cue } from "./transcript";
import {
  groupCues,
  HEATMAP_HEADING,
  parseJson3,
  pickCaptionTrack,
  renderHeatmap,
  renderTranscript,
  topPeaks,
  TRANSCRIPT_HEADING,
  upsertSection,
} from "./transcript";
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
}

/** Frontmatter key holding the path to a downloaded copy. */
export const LOCAL_MEDIA_KEY = "local_media";

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
  subscriptionsExpiryDays: 30,
  subscriptionsIncludeShorts: false,
  watchLaterFolder: "Watch Later",
};

/**
 * Players are keyed by video ID because timestamp links (`ytfree:<id>:<secs>`)
 * carry only the ID. `sourcePath` rides along so flow capture can ask the
 * narrower question it actually needs: which player belongs to *this* note.
 *
 * Known limitation: the same video embedded in two open notes collapses to one
 * entry, last render wins. Not worth a second index until it bites.
 */
interface PlayerEntry {
  player: YtFreePlayer;
  videoId: string;
  sourcePath: string;
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
 * One pinned player per open markdown view, mounted above the note body so it
 * stays put while the note scrolls under it.
 */
interface PinnedEntry {
  videoId: string;
  wrapper: HTMLElement;
  entry: PlayerEntry | null;
}

export default class YtFreePlugin extends Plugin {
  settings: YtFreeSettings = DEFAULT_SETTINGS;
  private cache = new StreamCache();
  private players = new Map<string, PlayerEntry>();
  private pinned = new Map<MarkdownView, PinnedEntry>();
  /** Last note whose properties we collapsed in a given view, so we do it once. */
  private collapsed = new Map<MarkdownView, string>();
  /** Notes whose docked player the reader closed by hand, per view. */
  private dismissed = new Map<MarkdownView, string>();
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
  private ytDlpPath: string | null = null;
  private resumeTimer: number | null = null;
  private downloads = new Map<string, DownloadHandle>();
  /** undefined = not probed yet; null = probed and absent. */
  private ffmpegPath: string | null | undefined = undefined;
  subscriptions!: SubscriptionsStore;

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.setupSubscriptions();

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
    this.registerDomEvent(document, "click", (evt) => {
      const target = (evt.target as HTMLElement)?.closest?.("a");
      if (!target) return;
      const href = target.getAttribute("href") ?? "";
      if (!href.startsWith("ytfree:")) return;

      evt.preventDefault();
      evt.stopPropagation();

      const [, videoId, seconds] = href.split(":");
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
      void this.seekEntry(entry, Number(seconds) || 0);
    });

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

    // Download and transcript both shell out to yt-dlp, which does not exist on
    // a phone. Registering them anyway would put commands in mobile's palette
    // that can only ever answer with an error.
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

      this.addCommand({
        id: "fetch-transcript",
        name: "Fetch transcript and most-replayed moments",
        callback: () => void this.fetchTranscriptForActiveNote(),
      });
    }

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

    this.addSettingTab(new YtFreeSettingTab(this.app, this));
  }

  // ---------------------------------------------------------- subscriptions

  /**
   * The subscriptions hub (issue 003).
   *
   * State lives in its own file next to `data.json` rather than inside it: the
   * index is thousands of rows, and settings should not be rewritten every time
   * a poll lands.
   */
  private async setupSubscriptions(): Promise<void> {
    const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
    this.subscriptions = new SubscriptionsStore(
      this.app,
      `${dir}/subscriptions.json`,
      () => this.hubSettings(),
    );
    await this.subscriptions.load();

    this.registerView(
      HUB_VIEW_TYPE,
      (leaf) => new HubView(leaf, this.subscriptions, () => this.hubSettings()),
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
    };
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
      // A player the reader closed stays closed, but only for the note it was
      // closed on: opening a different note in this view brings it back.
      if (this.dismissed.has(view) && this.dismissed.get(view) !== path) {
        this.dismissed.delete(view);
      }
      const wanted =
        this.dismissed.get(view) === path ? null : this.pinnedVideoIdFor(path);
      const current = this.pinned.get(view);

      // Keyed off "this note has a video", not off the player, so it still
      // applies when the pinned player is switched off.
      if (path && this.videoIdForNote(path)) this.collapseProperties(view, path);
      else if (path && this.collapsed.get(view) !== path) this.collapsed.delete(view);

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
    for (const view of [...this.dismissed.keys()]) {
      if (!open.has(view)) this.dismissed.delete(view);
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
    // No yt-dlp on a phone. A note clipped on mobile simply arrives without a
    // transcript and picks one up the next time it is opened on the Mac.
    if (!Platform.isDesktopApp) return;
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
    const { fetchVideoInfo, findYtDlp } = await desktop();

    let ytDlpPath: string;
    try {
      ytDlpPath = this.ytDlpPath ?? (await findYtDlp(this.settings.ytDlpPath));
      this.ytDlpPath = ytDlpPath;
    } catch {
      new Notice("YT Free: yt-dlp not found. Install it, or set its path in settings.");
      return;
    }

    const progress = new Notice("YT Free: fetching transcript…", 0);
    try {
      const info = await fetchVideoInfo(ytDlpPath, videoId);
      const track = pickCaptionTrack(info, this.settings.transcriptLanguage.trim() || "en");

      let cues: Cue[] = [];
      if (track) {
        // The URL yt-dlp hands back is already signed and immediately valid, so
        // it can be fetched directly — no second yt-dlp call, no temp file.
        const response = await requestUrl({ url: track.url, throw: true });
        cues = parseJson3(response.text);
      }

      const paragraphs = groupCues(cues, this.settings.transcriptIntervalSeconds);
      const peaks = topPeaks(info.heatmap, this.settings.heatmapPeaks);

      if (paragraphs.length === 0 && peaks.length === 0) {
        progress.hide();
        if (!quiet) {
          new Notice(
            track
              ? "YT Free: captions were empty for this video."
              : `YT Free: no ${this.settings.transcriptLanguage} captions and no heatmap for this video.`,
            8000,
          );
        }
        return;
      }

      await this.app.vault.process(file, (content) => {
        // Heatmap first: it is the short list you scan, and the transcript is
        // the long thing you scroll past everything else to reach.
        let next = upsertSection(content, HEATMAP_HEADING, renderHeatmap(peaks, cues, videoId));
        next = upsertSection(
          next,
          TRANSCRIPT_HEADING,
          renderTranscript(paragraphs, videoId, track),
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

    // Reserved, fixed-height row so showing or clearing a status message never
    // shifts the player or the surrounding note content.
    const status = wrapper.createDiv({ cls: "ytfree-status" });
    const setStatus = (message: string | null) => {
      status.setText(message ?? "");
      status.toggleClass("ytfree-status-visible", message !== null);
    };

    // Mobile keeps the media in its own fixed-aspect box, so the poster, the
    // video and the fallback all occupy exactly the same space and swapping
    // between them moves nothing.
    const media = mobile ? wrapper.createDiv({ cls: "ytfree-media" }) : wrapper;

    const provider = mobile
      ? this.mobileProvider(videoId)
      : this.desktopProvider(videoId);

    const noteFile = this.app.vault.getAbstractFileByPath(sourcePath);
    const player = new YtFreePlayer(
      wrapper,
      provider,
      setStatus,
      (seconds) => this.insertTimestampFromButton(videoId, seconds),
      // Downloading needs yt-dlp, so the button is desktop-only. A note file is
      // also required — there is nowhere to record the path without one.
      !mobile && noteFile instanceof TFile
        ? () => void this.startDownload(videoId, noteFile)
        : undefined,
      {
        mediaHost: media,
        minimalControls: mobile,
        onClose: mobile ? () => this.closePlayerFor(videoId) : undefined,
      },
    );
    const entry: PlayerEntry = { player, videoId, sourcePath, activate: null };
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
      return entry;
    }

    if (mobile) {
      this.deferMobileLoad(entry, media, setStatus);
      return entry;
    }

    setStatus("Resolving stream…");
    try {
      await player.load(this.settings.upgradeToHighQuality);
      setStatus(null);
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
  private closePlayerFor(videoId: string): void {
    for (const [view, record] of this.pinned) {
      if (record.videoId !== videoId) continue;
      const path = view.file?.path;
      if (path) this.dismissed.set(view, path);
      this.unmountPinned(view);
      return;
    }
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
}

class YtFreeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: YtFreePlugin) {
    super(app, plugin);
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
            "Quality above 360p, downloading, and transcript fetching all need yt-dlp, which only exists on the desktop app. " +
            "Fetch a transcript on the Mac and it syncs to this note like any other text.",
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
        "Notes created this session — from the template or the Web Clipper — get their transcript and replay peaks without being asked. Opening an older note never triggers it; use the command for those.",
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
