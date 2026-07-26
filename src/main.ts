import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  App,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import {
  applyLookback,
  isInsideCodeBlock,
  shouldAutoStamp,
  stampInsertOffset,
} from "./capture";
import { formatTimestamp } from "./format";
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
}

const DEFAULT_SETTINGS: YtFreeSettings = {
  ytDlpPath: "",
  upgradeToHighQuality: true,
  timestampFormat: "[{ts}]({link}) ",
  autoStampNewLine: true,
  lookbackSeconds: 5,
  pauseWhileTyping: true,
  resumeIdleMs: 2000,
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

export default class YtFreePlugin extends Plugin {
  settings: YtFreeSettings = DEFAULT_SETTINGS;
  private cache = new StreamCache();
  private players = new Map<string, PlayerEntry>();
  private lastActiveVideoId: string | null = null;
  private ytDlpPath: string | null = null;
  private resumeTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("ytfree", (source, el, ctx) =>
      this.renderBlock(source, el, ctx),
    );

    // Flow capture (issue 001). The stamp rides on the first character typed on
    // a line, so `inputHandler` — which sees real typing and not programmatic
    // edits — is the right hook. Enter is left entirely alone.
    this.registerEditorExtension([
      Prec.highest(
        EditorView.inputHandler.of((view, from, to, text) =>
          this.handleInput(view, from, to, text),
        ),
      ),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.handleTyping();
      }),
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
        editor.replaceSelection(
          this.timestampText(entry.videoId, this.captureSeconds(entry.player)),
        );
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

    this.addSettingTab(new YtFreeSettingTab(this.app, this));
  }

  onunload(): void {
    this.clearResumeTimer();
    for (const entry of this.players.values()) entry.player.destroy();
    this.players.clear();
    this.cache.clear();
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
    try {
      if (!this.settings.autoStampNewLine) return false;
      if (!text) return false;

      const line = view.state.doc.lineAt(from);
      const offset = stampInsertOffset(line.text, from - line.from);
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

      const stamp = this.timestampText(entry.videoId, this.captureSeconds(entry.player));
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
   * Any edit in a note with an active player pauses it, and playback resumes
   * once typing stops. Scope is the whole note, not just the stamped line.
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

  private timestampText(videoId: string, seconds: number): string {
    return this.settings.timestampFormat
      .replace("{ts}", formatTimestamp(seconds))
      .replace("{link}", `ytfree:${videoId}:${seconds}`)
      .replace("{seconds}", String(seconds));
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
      this.timestampText(videoId, applyLookback(seconds, this.settings.lookbackSeconds)),
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
    const wrapper = el.createDiv({ cls: "ytfree-wrapper" });
    // Reserved, fixed-height row so showing or clearing a status message never
    // shifts the player or the surrounding note content.
    const status = wrapper.createDiv({ cls: "ytfree-status" });
    const setStatus = (message: string | null) => {
      status.setText(message ?? "");
      status.toggleClass("ytfree-status-visible", message !== null);
    };

    const videoId = extractVideoId(source);
    if (!videoId) {
      this.renderError(wrapper, "Not a YouTube URL or video ID.", source.trim());
      return;
    }

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

    const player = new YtFreePlayer(wrapper, provider, setStatus, (seconds) =>
      this.insertTimestampFromButton(videoId, seconds),
    );
    const entry: PlayerEntry = { player, videoId, sourcePath: ctx.sourcePath };
    this.players.set(videoId, entry);
    player.video.addEventListener("play", () => {
      this.lastActiveVideoId = videoId;
    });

    // Tear the player down when the note or preview pane closes, so no stream
    // keeps buffering in the background.
    const self = this;
    ctx.addChild(
      new (class extends MarkdownRenderChild {
        onunload(): void {
          player.destroy();
          if (self.players.get(videoId) === entry) self.players.delete(videoId);
        }
      })(wrapper),
    );

    setStatus("Resolving stream…");
    try {
      await player.load(this.settings.upgradeToHighQuality);
      setStatus(null);
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
      .setDesc("Placeholders: {ts} formatted time, {link} seek link, {seconds} raw seconds.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.timestampFormat)
          .onChange(async (value) => {
            this.plugin.settings.timestampFormat = value;
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
        "Seconds subtracted from every captured timestamp, because you decide something is worth noting after you hear it. Applies to auto-stamps, the command, and the Timestamp button. Tune it against your own notes — lectures want more, dense tutorials want less.",
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
