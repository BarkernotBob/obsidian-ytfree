/**
 * The settings tab.
 *
 * Written once, as data (`pages`), and drawn two ways:
 *
 *   - Obsidian 1.13 and later read `getSettingDefinitions()`: each page is a
 *     native sub-page (a row on the plugin's settings screen that opens its own
 *     page), and every row is in Obsidian's settings search;
 *   - older versions call `display()`, which draws the same rows as one list,
 *     a heading per page.
 *
 * Both run the same `build` for a row, so a control cannot differ between them.
 */

import { Modal, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinition, SettingDefinitionItem } from "obsidian";
import { markDestructive } from "./destructive.ts";
import { HANDOFF_BOOKMARKLET } from "./handoff.ts";
import { ImportSubscriptionsModal, SearchBlocklistModal } from "./hub.ts";
import { describeTestOutcome, describeWebhook } from "./notify.ts";
import type YtFreePlugin from "./main.ts";
import type { YtFreeSettings } from "./settings.ts";

/** One settings row: what search sees, and how its control is built. */
interface Row {
  name: string;
  desc?: string;
  /** Extra words settings search should find this row by. */
  aliases?: string[];
  /** Adds the control. Left out for a row that is only text. */
  build?: (setting: Setting) => unknown;
}

/** Rows under one heading inside a page. No heading: the page's only group. */
interface Group {
  heading?: string;
  rows: Row[];
}

/**
 * One sub-page on 1.13+; one heading in the older flat list. `folded` puts it
 * behind a collapsed disclosure in the flat list, because the defaults are the
 * answer and a user who opens it should have a reason.
 */
interface Page {
  name: string;
  desc: string;
  folded?: boolean;
  groups: Group[];
}

/** The settings whose control is a plain on/off switch. */
type ToggleKey = {
  [K in keyof YtFreeSettings]-?: YtFreeSettings[K] extends boolean ? K : never;
}[keyof YtFreeSettings];

/** The settings whose control is a slider over the stored number itself. */
type NumberKey = {
  [K in keyof YtFreeSettings]-?: YtFreeSettings[K] extends number ? K : never;
}[keyof YtFreeSettings];

export class YtFreeSettingTab extends PluginSettingTab {
  /** The reserved line under the webhook field — see `setNotifyStatus`. */
  private notifyStatusEl: HTMLElement | null = null;
  /**
   * True only while `display()` draws, i.e. on Obsidian older than 1.13, the
   * one place a slider still needs `setDynamicTooltip` to show its value.
   */
  private legacy = false;

  constructor(
    app: App,
    private plugin: YtFreePlugin,
  ) {
    super(app, plugin);
  }

  hide(): void {
    this.notifyStatusEl = null;
  }

  /** Obsidian older than 1.13: every page as one list, a heading per page. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.legacy = true;
    try {
      for (const page of this.pages()) {
        let host: HTMLElement = containerEl;
        if (page.folded) {
          host = containerEl.createEl("details", { cls: "ytfree-advanced" });
          host.createEl("summary", { text: page.name });
          host.createEl("p", { text: page.desc, cls: "setting-item-description" });
        } else {
          new Setting(containerEl).setName(page.name).setHeading();
        }
        for (const group of page.groups) {
          for (const row of group.rows) this.draw(new Setting(host), row);
        }
      }
    } finally {
      this.legacy = false;
    }
  }

  /** Obsidian 1.13+: one native sub-page per page, rows searchable. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.pages().map((page) => {
      const items: SettingDefinitionItem[] = [];
      for (const group of page.groups) {
        const rows = group.rows.map((row) => this.definition(row));
        if (group.heading) items.push({ type: "group", heading: group.heading, items: rows });
        else items.push(...rows);
      }
      return { type: "page", name: page.name, desc: page.desc, items };
    });
  }

  private definition(row: Row): SettingDefinition {
    return {
      name: row.name,
      desc: row.desc,
      aliases: row.aliases,
      render: (setting) => this.draw(setting, row),
    };
  }

  private draw(setting: Setting, row: Row): void {
    setting.setName(row.name);
    if (row.desc) setting.setDesc(row.desc);
    row.build?.(setting);
  }

  /** Counts and other live text changed: draw again. */
  private redraw(): void {
    const modern = this as unknown as { update?: () => void };
    if (typeof modern.update === "function") modern.update();
    else this.display();
  }

  /** The one line that reports on the webhook, kept at a constant height. */
  private setNotifyStatus(text: string): void {
    // A non-breaking space rather than an empty string: an empty div collapses,
    // and this line sits between two settings rows that must not move.
    this.notifyStatusEl?.setText(text || "\u00a0");
  }

  // ------------------------------------------------------------ row helpers

  private toggle(key: ToggleKey, name: string, desc: string, after?: (value: boolean) => void): Row {
    const { plugin } = this;
    return {
      name,
      desc,
      build: (setting) =>
        setting.addToggle((toggle) =>
          toggle.setValue(plugin.settings[key]).onChange(async (value) => {
            plugin.settings[key] = value;
            await plugin.saveSettings();
            after?.(value);
          }),
        ),
    };
  }

  private slider(
    key: NumberKey,
    name: string,
    desc: string,
    limits: [min: number, max: number, step: number],
    after?: () => void,
  ): Row {
    const { plugin } = this;
    return {
      name,
      desc,
      build: (setting) =>
        setting.addSlider((slider) =>
          this.showValue(slider)
            .setLimits(...limits)
            .setValue(plugin.settings[key])
            .onChange(async (value) => {
              plugin.settings[key] = value;
              await plugin.saveSettings();
              after?.();
            }),
        ),
    };
  }

  /**
   * 1.13+ always shows a slider's value. Older versions only show it with
   * `setDynamicTooltip`, deprecated since, so it is called on that path alone.
   */
  private showValue<T extends { setDynamicTooltip(): T }>(slider: T): T {
    return this.legacy ? slider.setDynamicTooltip() : slider;
  }

  // --------------------------------------------------------------- the rows

  private pages(): Page[] {
    const desktopApp = Platform.isDesktopApp;
    return [
      {
        name: "Playback",
        desc: "HD, skipping pauses, pausing while you type.",
        groups: [
          { heading: "Quality", rows: this.qualityRows(desktopApp) },
          { heading: "Skip pauses", rows: this.skipPauseRows() },
          { heading: "While you type", rows: this.typingRows() },
        ],
      },
      {
        name: "Notes",
        desc: "Timestamps, the pinned player, where new notes go.",
        groups: [
          { heading: "Timestamps", rows: this.timestampRows() },
          { heading: "Layout", rows: this.layoutRows() },
          { heading: "Files", rows: this.fileRows() },
        ],
      },
      { name: "Transcripts", desc: "Fetching, language, following along.", groups: [{ rows: this.transcriptRows() }] },
      {
        name: "Subscriptions",
        desc: "Importing, checking for new videos, watch history.",
        groups: [
          { heading: "Channels", rows: this.channelRows() },
          { heading: "Search", rows: this.searchRows() },
          { heading: "History", rows: this.historyRows() },
        ],
      },
      { name: "Alerts", desc: "Phone notifications for new videos.", groups: [{ rows: this.alertRows() }] },
      { name: "Links", desc: "Open YouTube links in Obsidian.", groups: [{ rows: this.linkRows() }] },
      {
        name: "Advanced",
        desc: "Formats and troubleshooting. The defaults suit almost everyone.",
        folded: true,
        groups: [{ rows: this.advancedRows(desktopApp) }],
      },
    ];
  }

  private qualityRows(desktopApp: boolean): Row[] {
    const hd = desktopApp
      ? this.toggle(
          "upgradeToHighQuality",
          "HD video",
          "Starts at 360p so it plays fast, then sharpens to HD (up to 1080p). Turn off to save data.",
        )
      : this.toggle(
          "phoneHighQuality",
          "HD video",
          "Starts at 360p so it plays fast, then sharpens to HD (up to 1080p). Needs iOS 17.1 or later and uses more data.",
        );
    return [
      { ...hd, aliases: ["high quality", "1080p", "resolution"] },
      this.toggle(
        "startInHd",
        "Wait for HD",
        "Hold the video until HD is ready, up to 15 seconds, so it never starts blurry. Only applies while HD video is on.",
      ),
    ];
  }

  private skipPauseRows(): Row[] {
    const { plugin } = this;
    const refresh = (): void => plugin.refreshSmartSpeed();
    return [
      {
        ...this.toggle(
          "smartSpeed",
          "Skip pauses",
          "Jump over the stretches where nobody is talking, using the captions. Every player also has its own switch; this is how it starts.",
        ),
        aliases: ["smart speed", "silence", "compress pauses"],
      },
      {
        name: "Shortest pause to skip",
        desc: "Shorter skips more. Longer only skips real gaps, which suits fast talkers.",
        build: (setting) =>
          setting.addDropdown((dropdown) => {
            const options: Array<[number, string]> = [
              [0.4, "0.4 s (most)"],
              [0.5, "0.5 s (balanced)"],
              [0.75, "0.75 s"],
              [1, "1 s"],
              [1.5, "1.5 s"],
              [2, "2 s (only long gaps)"],
            ];
            for (const [value, label] of options) dropdown.addOption(String(value), label);
            dropdown.setValue(String(plugin.settings.silenceMinGap)).onChange(async (value) => {
              plugin.settings.silenceMinGap = Number(value);
              await plugin.saveSettings();
              refresh();
            });
          }),
      },
    ];
  }

  private typingRows(): Row[] {
    const { plugin } = this;
    const resumeText = (ms: number): string =>
      `Plays again after ${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")} s without typing.`;
    return [
      this.toggle(
        "pauseWhileTyping",
        "Pause while typing",
        "The video pauses when you type in its note, and plays again when you stop. A video you paused yourself stays paused.",
      ),
      {
        // Seconds on screen, milliseconds in `data.json`: that is what
        // `setTimeout` wants and what every existing file already holds.
        name: "Play again after",
        desc: resumeText(plugin.settings.resumeIdleMs),
        aliases: ["resume"],
        build: (setting) =>
          setting.addSlider((slider) =>
            this.showValue(slider)
              .setLimits(0.25, 5, 0.25)
              .setValue(plugin.settings.resumeIdleMs / 1000)
              .onChange(async (value) => {
                plugin.settings.resumeIdleMs = Math.round(value * 1000);
                setting.setDesc(resumeText(plugin.settings.resumeIdleMs));
                await plugin.saveSettings();
              }),
          ),
      },
    ];
  }

  private timestampRows(): Row[] {
    return [
      this.toggle(
        "autoStampNewLine",
        "Timestamp every new line",
        "Once the video has played, the first thing you type on a new line gets its current time. Off, use the Insert timestamp command.",
      ),
      {
        ...this.slider(
          "lookbackSeconds",
          "Rewind timestamps by",
          "Seconds. Each timestamp links a little earlier than when you typed, because you write a note after you hear the moment. The time shown doesn't change.",
          [0, 30, 1],
        ),
        aliases: ["lookback"],
      },
      this.toggle(
        "linkifyTimestamps",
        "Make times clickable",
        "Plain times like 12:34 in a video note, such as a pasted chapter list, jump the video there.",
      ),
    ];
  }

  private layoutRows(): Row[] {
    const { plugin } = this;
    const repin = (): void => plugin.refreshPinnedPlayers();
    return [
      this.toggle(
        "pinnedPlayer",
        "Pin the player",
        "Keep the player at the top of a video note while you scroll. Off, a Player button in the corner brings it back.",
        repin,
      ),
      this.slider(
        "pinnedHeightVh",
        "Player height",
        "Percent of the window the pinned player uses. On a phone the video shrinks to fit inside it.",
        [20, 70, 5],
        repin,
      ),
      this.toggle(
        "collapseProperties",
        "Fold properties",
        "Hide the properties block when a video note opens, so the player and your notes come first.",
      ),
      this.toggle(
        "collapseSections",
        "Fold description and transcript",
        "Open video notes with just your notes showing. Tap a section to unfold it.",
      ),
    ];
  }

  private fileRows(): Row[] {
    const { plugin } = this;
    return [
      {
        name: "Folder for new notes",
        desc: "Where a video's note goes when you open the video from the hub.",
        aliases: ["watch later"],
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("Watch Later")
              .setValue(plugin.settings.watchLaterFolder)
              .onChange(async (value) => {
                plugin.settings.watchLaterFolder = value.trim();
                await plugin.saveSettings();
              }),
          ),
      },
      {
        ...this.slider(
          "tidyEmptyNoteDays",
          "Clean up empty notes after",
          "Days. Notes for videos you played but never wrote in go to Obsidian's trash after this long. Notes you never played are left alone. 0 is off.",
          [0, 180, 5],
        ),
        aliases: ["tidy"],
      },
    ];
  }

  private transcriptRows(): Row[] {
    const { plugin } = this;
    return [
      this.toggle(
        "autoFetchTranscript",
        "Add to new notes",
        "Fetch the transcript when a video note is created. For older notes, use the Fetch transcript command.",
      ),
      {
        name: "Language",
        desc: "A language code such as en or es. The uploader's own captions win over auto-generated ones.",
        aliases: ["caption language"],
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("en")
              .setValue(plugin.settings.transcriptLanguage)
              .onChange(async (value) => {
                plugin.settings.transcriptLanguage = value;
                await plugin.saveSettings();
              }),
          ),
      },
      this.slider(
        "transcriptIntervalSeconds",
        "Paragraph length",
        "Seconds. Each paragraph is one clickable chunk this long. Shorter jumps more precisely and makes a longer note.",
        [5, 180, 1],
      ),
      this.toggle(
        "followTranscript",
        "Follow along",
        "Once you jump into the transcript, it highlights the line being spoken and scrolls with the video. Scroll or type to stop it.",
        // Off means off now, not at the next note: something may be following
        // this second.
        (value) => {
          if (!value) plugin.stopFollowingTranscript();
        },
      ),
      {
        ...this.slider(
          "heatmapPeaks",
          "Most-replayed moments",
          "How many to list above the transcript. 0 hides them.",
          [0, 20, 1],
        ),
        aliases: ["heatmap"],
      },
    ];
  }

  private channelRows(): Row[] {
    const { plugin } = this;
    return [
      {
        name: "Import from YouTube",
        desc: "Use the subscriptions file from Google Takeout. Importing again adds new channels and removes none.",
        aliases: ["takeout", "import subscriptions"],
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Import…")
              .onClick(() =>
                new ImportSubscriptionsModal(this.app, plugin.subscriptions, () => plugin.refreshHub()).open(),
              ),
          ),
      },
      this.slider(
        "subscriptionsPollMinutes",
        "Check for new videos every",
        "Minutes. Also checks once when Obsidian starts. A channel's feed holds only its last 15 videos, so very long gaps can miss some.",
        [15, 360, 15],
      ),
      this.toggle(
        "subscriptionsIncludeShorts",
        "Include Shorts",
        "Show Shorts from your channels in the hub.",
        () => plugin.refreshHub(),
      ),
      this.slider(
        "subscriptionsExpiryDays",
        "Remove unwatched videos after",
        "Days since a video was published. Only from the hub: your notes are never touched. 0 keeps everything.",
        [0, 180, 5],
      ),
    ];
  }

  private searchRows(): Row[] {
    const { plugin } = this;
    const hiddenCount = plugin.subscriptions.hiddenSearchChannels().length;
    return [
      {
        name: "Hidden channels",
        desc: `${hiddenCount} ${hiddenCount === 1 ? "channel" : "channels"} hidden from search results. Hide one with the ⋯ on a search result; subscribing shows it again.`,
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Manage…")
              .onClick(() =>
                new SearchBlocklistModal(this.app, plugin.subscriptions, "channels", () => this.redraw()).open(),
              ),
          ),
      },
    ];
  }

  private historyRows(): Row[] {
    const { plugin } = this;
    return [
      {
        name: "Clear watch history",
        desc: "Deletes your history and watch time on every device. Your notes stay. This can't be undone.",
        build: (setting) =>
          setting.addButton((button) => {
            button.setButtonText("Clear…").onClick(() => {
              new ConfirmClearHistoryModal(this.app, () => void plugin.history.clear()).open();
            });
            markDestructive(button);
          }),
      },
    ];
  }

  /**
   * The push that tells your phone a video landed in the Inbox.
   *
   * Everything in here is drawn unconditionally — the toggle does not add or
   * remove a row, and the button's label never changes width. A settings pane
   * that reflows under the finger that clicked it is the one thing this section
   * was not allowed to do.
   *
   * Shown on the phone as well as the Mac, even though the Mac is almost always
   * the device that polls: the settings are one file synced with the vault.
   */
  private alertRows(): Row[] {
    const { plugin } = this;
    const report = (): void => this.setNotifyStatus(describeWebhook(plugin.hubSettings().notifications));
    return [
      this.toggle(
        "notificationsEnabled",
        "Send alerts",
        "Get a notification when new videos arrive in the hub: one per check, never one per video.",
        report,
      ),
      {
        name: "Alert address",
        desc: "Obsidian can't notify your phone by itself, so it posts to an https address that can: ntfy.sh, Pushover or an Apple Shortcuts automation.",
        aliases: ["webhook", "notification"],
        build: (setting) => {
          // Its own reserved line. It says whether the URL parses, then what the
          // last test did — three different lengths of text in the same fixed height.
          this.notifyStatusEl = setting.descEl.createDiv({ cls: "ytfree-notify-status" });
          report();
          setting.addText((text) =>
            text
              .setPlaceholder("https://ntfy.sh/your-random-topic")
              .setValue(plugin.settings.notificationWebhook)
              .onChange(async (value) => {
                plugin.settings.notificationWebhook = value.trim();
                await plugin.saveSettings();
                report();
              }),
          );
        },
      },
      {
        name: "Format",
        desc: "Text for ntfy.sh, which shows the message as is. JSON for Shortcuts and automations: it carries the channels, titles and links.",
        build: (setting) =>
          setting.addDropdown((dropdown) =>
            dropdown
              .addOption("json", "JSON")
              .addOption("text", "Text")
              .setValue(plugin.settings.notificationFormat)
              .onChange(async (value) => {
                plugin.settings.notificationFormat = value === "text" ? "text" : "json";
                await plugin.saveSettings();
              }),
          ),
      },
      {
        name: "Test it",
        desc: "Send one alert now, without waiting for a new video.",
        build: (setting) =>
          setting.addButton((button) => {
            // Fixed width, and a label that never changes: the result is reported
            // on the reserved line above, not by rewriting the thing that was pressed.
            button.buttonEl.addClass("ytfree-notify-button");
            button.setButtonText("Send test").onClick(async () => {
              this.setNotifyStatus("Sending…");
              const outcome = await plugin.subscriptions.sendTestNotification();
              this.setNotifyStatus(describeTestOutcome(outcome));
            });
          }),
      },
    ];
  }

  private linkRows(): Row[] {
    return [
      this.toggle(
        "openYouTubeLinksHere",
        "Open YouTube links here",
        "A YouTube link in a note opens in YouTube for You at its timestamp, not in the browser. To send links from other apps, see the plugin's README.",
      ),
      {
        name: "Browser bookmarklet",
        desc: "Sends the YouTube tab you're on to Obsidian. Copy it, then save it as a bookmark's address.",
        build: (setting) =>
          setting.addButton((button) =>
            button.setButtonText("Copy").onClick(async () => {
              await navigator.clipboard.writeText(HANDOFF_BOOKMARKLET);
              new Notice("YouTube for You: bookmarklet copied.");
            }),
          ),
      },
    ];
  }

  private advancedRows(desktopApp: boolean): Row[] {
    const { plugin } = this;
    const rows: Row[] = [
      {
        name: "Timestamp format",
        desc: "{ts} is the time shown, {link} the jump link, {seconds} the jump point in seconds.",
        build: (setting) =>
          setting.addText((text) =>
            text.setValue(plugin.settings.timestampFormat).onChange(async (value) => {
              plugin.settings.timestampFormat = value;
              await plugin.saveSettings();
            }),
          ),
      },
      {
        name: "Video link properties",
        desc: "Note properties checked for a video link, comma-separated, in order. The first YouTube link found gets the player.",
        aliases: ["frontmatter"],
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("media_link, url")
              .setValue(plugin.settings.pinnedFrontmatterKeys)
              .onChange(async (value) => {
                plugin.settings.pinnedFrontmatterKeys = value;
                await plugin.saveSettings();
                plugin.refreshPinnedPlayers();
              }),
          ),
      },
      this.slider(
        "silenceWordPad",
        "Word guard",
        "Seconds kept clear around each spoken word, so Skip pauses never cuts one off. Lower skips more and risks clipping words. 0 turns it off.",
        [0, 0.5, 0.05],
        () => plugin.refreshSmartSpeed(),
      ),
    ];
    // Phone only, and drawn only there: on a desktop the stream is resolved at
    // mount already, so the control would do nothing at all.
    if (!desktopApp) {
      rows.push(
        this.toggle(
          "warmOnOpen",
          "Get video ready on open",
          "Full screen and Picture-in-Picture work on the first tap, but every video note you open contacts YouTube. Off, nothing is fetched until you tap Play.",
        ),
      );
    }
    rows.push(
      this.toggle(
        "debugLogs",
        "Debug log",
        "Writes what the player does to the developer console, and adds a command that lists this session's YouTube requests. Turn on only to report a bug.",
        () => plugin.refreshPinnedPlayers(),
      ),
    );
    return rows;
  }
}

/** "Clear history?" — asked once, because nothing brings it back (GitHub #48). */
class ConfirmClearHistoryModal extends Modal {
  constructor(
    app: App,
    private readonly onConfirm: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("Clear watch history?");
    this.contentEl.createEl("p", {
      text: "Delete your whole watch history and stats on all devices? This can't be undone.",
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) => {
        button.setButtonText("Clear history").onClick(() => {
          this.onConfirm();
          this.close();
        });
        markDestructive(button);
      });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
