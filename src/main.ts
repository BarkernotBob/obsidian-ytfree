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
}

const DEFAULT_SETTINGS: YtFreeSettings = {
  ytDlpPath: "",
  upgradeToHighQuality: true,
  timestampFormat: "[{ts}]({link}) ",
};

export default class YtFreePlugin extends Plugin {
  settings: YtFreeSettings = DEFAULT_SETTINGS;
  private cache = new StreamCache();
  private players = new Map<string, YtFreePlayer>();
  private lastActiveVideoId: string | null = null;
  private ytDlpPath: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("ytfree", (source, el, ctx) =>
      this.renderBlock(source, el, ctx),
    );

    this.addCommand({
      id: "insert-timestamp",
      name: "Insert timestamp at cursor",
      editorCallback: (editor) => {
        const player = this.activePlayer();
        if (!player || !this.lastActiveVideoId) {
          new Notice("YT Free: no player in this note yet. Play a video first.");
          return;
        }
        editor.replaceSelection(
          this.timestampText(this.lastActiveVideoId, Math.floor(player.currentTime)),
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
      const player = this.players.get(videoId);
      if (!player) {
        new Notice("YT Free: that video is not open in this note.");
        return;
      }
      this.lastActiveVideoId = videoId;
      player.seekTo(Number(seconds) || 0);
    });

    this.addSettingTab(new YtFreeSettingTab(this.app, this));
  }

  onunload(): void {
    for (const player of this.players.values()) player.destroy();
    this.players.clear();
    this.cache.clear();
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
    editor.replaceSelection(this.timestampText(videoId, seconds));
  }

  private activePlayer(): YtFreePlayer | null {
    if (this.lastActiveVideoId) {
      const p = this.players.get(this.lastActiveVideoId);
      if (p) return p;
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
    this.players.set(videoId, player);
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
          if (self.players.get(videoId) === player) self.players.delete(videoId);
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
  }
}
