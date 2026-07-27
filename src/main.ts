import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { existsSync } from "fs";
import { mkdir, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import {
  App,
  FileSystemAdapter,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
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
import {
  DownloadHandle,
  downloadBaseName,
  downloadVideo,
  findFfmpeg,
  formatBytes,
  freeBytes,
  LARGE_FILE_BYTES,
  localFileUrl,
  MIN_FREE_BYTES,
  resolveLocalFile,
} from "./download";
import { findTimestamps } from "./description";
import { formatTimestamp } from "./format";
import type { Cue } from "./transcript";
import {
  fetchVideoInfo,
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
  findYtDlp,
  ResolveMode,
  resolveStream,
  ResolvedStream,
  StreamCache,
  YtDlpMissingError,
} from "./resolver";

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
  // Deliberately outside the vault: the vault is in iCloud, and a 700MB video
  // inside it would sync to every device and eat the quota.
  downloadFolder: join(homedir(), "Movies", "YT Free"),
  ffmpegPath: "",
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

  async onload(): Promise<void> {
    await this.loadSettings();

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
      entry.player.seekTo(Number(seconds) || 0);
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
      id: "fetch-transcript",
      name: "Fetch transcript and most-replayed moments",
      callback: () => void this.fetchTranscriptForActiveNote(),
    });

    this.addSettingTab(new YtFreeSettingTab(this.app, this));
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

      const wanted = this.pinnedVideoIdFor(view.file?.path);
      const current = this.pinned.get(view);

      // Keyed off "this note has a video", not off the player, so it still
      // applies when the pinned player is switched off.
      const path = view.file?.path;
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
    if (!path) return null;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const recorded = this.app.metadataCache.getFileCache(file)?.frontmatter?.[LOCAL_MEDIA_KEY];
    // Search the folder even with nothing recorded: a file downloaded on this
    // Mac is findable by its [videoId] marker regardless of what the note says.
    return resolveLocalFile(
      typeof recorded === "string" ? recorded : "",
      this.settings.downloadFolder,
      videoId,
    );
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

    const dir = this.settings.downloadFolder;
    try {
      await mkdir(dir, { recursive: true });
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
    try {
      await unlink(local);
    } catch (err) {
      new Notice(`YT Free: could not delete the file — ${(err as Error).message}`);
      return;
    }
    await this.setLocalMedia(context.file, null);
    new Notice("YT Free: local copy deleted. This note streams again from now on.");
  }

  private async mountPinned(view: MarkdownView, videoId: string, sourcePath: string): Promise<void> {
    const wrapper = createDiv({ cls: "ytfree-wrapper ytfree-pinned" });
    wrapper.style.setProperty("--ytfree-pinned-height", `${this.settings.pinnedHeightVh}vh`);
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
    // Reserved, fixed-height row so showing or clearing a status message never
    // shifts the player or the surrounding note content.
    const status = wrapper.createDiv({ cls: "ytfree-status" });
    const setStatus = (message: string | null) => {
      status.setText(message ?? "");
      status.toggleClass("ytfree-status-visible", message !== null);
    };

    const provider = async (
      mode: ResolveMode,
      forceRefresh: boolean,
    ): Promise<ResolvedStream> => {
      if (forceRefresh) this.cache.invalidate(videoId);
      const cached = this.cache.get(videoId, mode);
      if (cached) return cached;

      if (!this.ytDlpPath) {
        this.ytDlpPath = await findYtDlp(this.settings.ytDlpPath);
      }
      const stream = await resolveStream(videoId, this.ytDlpPath, mode);
      this.cache.set(videoId, stream);
      return stream;
    };

    const noteFile = this.app.vault.getAbstractFileByPath(sourcePath);
    const player = new YtFreePlayer(
      wrapper,
      provider,
      setStatus,
      (seconds) => this.insertTimestampFromButton(videoId, seconds),
      noteFile instanceof TFile ? () => void this.startDownload(videoId, noteFile) : undefined,
    );
    const entry: PlayerEntry = { player, videoId, sourcePath };
    this.players.set(videoId, entry);
    player.video.addEventListener("play", () => {
      this.lastActiveVideoId = videoId;
    });

    // A present local copy wins: no yt-dlp, no expiry, instant first frame.
    const localFile = await this.localFileFor(sourcePath, videoId);
    if (localFile) {
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
    containerEl.empty();

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

    new Setting(containerEl).setName("Offline downloads").setHeading();

    const folderSetting = new Setting(containerEl)
      .setName("Download folder")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.downloadFolder)
          .setValue(this.plugin.settings.downloadFolder)
          .onChange(async (value) => {
            this.plugin.settings.downloadFolder = value.trim() || DEFAULT_SETTINGS.downloadFolder;
            await this.plugin.saveSettings();
            describeFolder();
          }),
      );

    // A path inside the vault is the one mistake here that is expensive and hard
    // to undo, because the vault syncs. Say so at the moment it is made.
    const describeFolder = () => {
      const vaultPath = this.plugin.vaultPath();
      const chosen = this.plugin.settings.downloadFolder;
      const inVault = Boolean(vaultPath) && chosen.startsWith(vaultPath as string);
      folderSetting.setDesc(
        inVault
          ? "⚠ This folder is inside your vault. Downloads will sync to every device and count against iCloud storage. Pick somewhere outside the vault."
          : "Where downloaded videos are kept. Outside the vault on purpose — these files are a local cache, not vault content.",
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
