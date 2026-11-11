/**
 * The settings tab.
 *
 * Written once, as data (`sections`), and drawn two ways:
 *
 *   - Obsidian 1.13 and later read `getSettingDefinitions()`, which is what
 *     puts every row in Obsidian's settings search;
 *   - older versions call `display()`, which draws the same rows by hand.
 *
 * Both run the same `build` for a row, so a control cannot differ between them.
 */

import { Modal, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type { App, SettingDefinition, SettingDefinitionItem } from "obsidian";
import { HANDOFF_BOOKMARKLET } from "./handoff.ts";
import { ImportSubscriptionsModal, SearchBlocklistModal } from "./hub.ts";
import { describeTestOutcome, describeWebhook } from "./notify.ts";
import type YtFreePlugin from "./main.ts";
import type { YtFreeSettings } from "./settings.ts";

/** Where the optional desktop helpers are explained. */
const HELPERS_DOC = "https://github.com/BarkernotBob/obsidian-ytfree/blob/main/docs/DESKTOP-HELPERS.md";

/** One settings row: what search sees, and how its control is built. */
interface Row {
  name: string;
  desc?: string;
  /** Extra words settings search should find this row by. */
  aliases?: string[];
  /** Adds the control. Left out for a row that is only text. */
  build?: (setting: Setting) => void;
}

/** Rows under one heading. No heading: the rows at the top of the tab. */
interface Section {
  heading?: string;
  /**
   * Folded away behind an "Advanced" disclosure on older Obsidian, under its
   * own heading on 1.13+. `note` is the warning shown before its rows.
   */
  advanced?: { note: string };
  rows: Row[];
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

  constructor(
    app: App,
    private plugin: YtFreePlugin,
  ) {
    super(app, plugin);
  }

  hide(): void {
    this.notifyStatusEl = null;
  }

  /** Obsidian older than 1.13: draw the rows by hand. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const section of this.sections()) {
      let host: HTMLElement = containerEl;
      if (section.advanced) {
        // Collapsed, because the defaults are the answer and a user who opens
        // this should have a reason.
        host = containerEl.createEl("details", { cls: "ytfree-advanced" });
        host.createEl("summary", { text: section.heading ?? "Advanced" });
        host.createEl("p", { text: section.advanced.note, cls: "setting-item-description" });
      } else if (section.heading) {
        new Setting(containerEl).setName(section.heading).setHeading();
      }
      for (const row of section.rows) this.draw(new Setting(host), row);
    }
  }

  /** Obsidian 1.13+: the same rows, as definitions it can render and search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [];
    for (const section of this.sections()) {
      const rows = section.rows.map((row) => this.definition(row));
      if (!section.heading) {
        items.push(...rows);
        continue;
      }
      const note: SettingDefinition[] = section.advanced
        ? [{ name: "About these settings", desc: section.advanced.note, searchable: false }]
        : [];
      items.push({ type: "group", heading: section.heading, items: [...note, ...rows] });
    }
    return items;
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
    this.display();
  }

  /** The one line that reports on the webhook, kept at a constant height. */
  private setNotifyStatus(text: string): void {
    // A non-breaking space rather than an empty string: an empty div collapses,
    // and this line sits between two settings rows that must not move.
    this.notifyStatusEl?.setText(text || " ");
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
          slider
            .setLimits(...limits)
            .setValue(plugin.settings[key])
            // Deprecated in 1.13, where the value is always shown. Still the
            // only way to see the value on the older versions we support.
            .setDynamicTooltip()
            .onChange(async (value) => {
              plugin.settings[key] = value;
              await plugin.saveSettings();
              after?.();
            }),
        ),
    };
  }

  // --------------------------------------------------------------- the rows

  private sections(): Section[] {
    const desktopApp = Platform.isDesktopApp;
    const sections: Section[] = [
      { rows: this.playbackRows(desktopApp) },
      { heading: "Subscriptions hub", rows: this.hubRows() },
      { heading: "YouTube links", rows: this.linkRows() },
      { heading: "New-video notifications", rows: this.notificationRows() },
      { heading: "Pinned player", rows: this.pinnedRows() },
      { heading: "Smart Speed", rows: this.smartSpeedRows() },
      {
        // Everything here is a dial on the *safety margins*, and every one of
        // them trades accuracy for aggressiveness in the direction that clips
        // words. 022 was caused by one of these being a front-page setting
        // with a wrong default.
        heading: "Smart Speed: advanced",
        advanced: { note: "These trade accuracy for aggressiveness. Raising them can clip or skip real speech." },
        rows: this.smartSpeedAdvancedRows(desktopApp),
      },
      { heading: "Transcript", rows: this.transcriptRows() },
      { heading: "Flow capture", rows: this.flowRows(desktopApp) },
      { heading: "Troubleshooting", rows: this.troubleshootingRows() },
    ];
    // Last, and folded away (Isaiah, 2026-11-10): nobody needs these to watch
    // a video, and a store user should never be asked to install anything.
    if (desktopApp) {
      sections.push({
        heading: "Desktop helpers (optional)",
        advanced: {
          note:
            "YT Free needs none of this. If yt-dlp is already on this computer, YT Free uses it for offline downloads; " +
            `ffmpeg adds downloads above 360p and finer Smart Speed. Setup steps: ${HELPERS_DOC}`,
        },
        rows: this.helperRows(),
      });
    }
    return sections;
  }

  private playbackRows(desktopApp: boolean): Row[] {
    const { plugin } = this;
    const startInHd = this.toggle(
      "startInHd",
      "Start in HD",
      "Wait for HD before the video starts, and start it at full quality instead of sharpening a few seconds in. " +
        "If HD isn't ready within 15 seconds it starts at 360p and sharpens later. Only applies while HD is on.",
    );
    const device: Row[] = desktopApp
      ? [
          this.toggle(
            "upgradeToHighQuality",
            "Upgrade to high quality",
            "Video always starts fast at 360p, then silently upgrades to HD (up to 1080p) a few seconds later, still streaming. Turn off to stay at 360p and save bandwidth.",
          ),
          startInHd,
        ]
      : [
          // Saying this once, plainly, beats a mobile user wondering why the
          // picture is soft and where the download button went.
          {
            name: "On this device",
            desc:
              "Playback here resolves the stream in the plugin and plays it in a normal video element — ad-free, at 360p unless HD is on below. " +
              "Transcripts and most-replayed moments both work here, read straight off YouTube. " +
              "Offline downloads are desktop only.",
          },
          this.toggle(
            "phoneHighQuality",
            "HD on this phone (experimental)",
            "Starts at 360p, then switches to HD (up to 1080p) a few seconds in, still streaming. Needs iOS 17.1 or later, and uses several times the data.",
          ),
          startInHd,
        ];
    return [
      ...device,
      {
        name: "Timestamp format",
        desc: "Placeholders: {ts} the time you wrote the line, {link} seek link, {seconds} raw seek seconds. {ts} shows where you were; {link} and {seconds} point Lookback seconds earlier, so clicking lands just before it.",
        build: (setting) =>
          setting.addText((text) =>
            text.setValue(plugin.settings.timestampFormat).onChange(async (value) => {
              plugin.settings.timestampFormat = value;
              await plugin.saveSettings();
            }),
          ),
      },
    ];
  }

  private hubRows(): Row[] {
    const { plugin } = this;
    const removedCount = plugin.subscriptions.removedSearchVideos().length;
    const hiddenCount = plugin.subscriptions.hiddenSearchChannels().length;
    return [
      {
        name: "Import subscriptions",
        desc: "Google Takeout → YouTube and YouTube Music → subscriptions only. Importing again later adds new channels and removes nothing.",
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Import…")
              .onClick(() =>
                new ImportSubscriptionsModal(this.app, plugin.subscriptions, () => plugin.refreshHub()).open(),
              ),
          ),
      },
      {
        name: "New-note folder",
        desc: "Where clicking a video in the hub puts its note.",
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
      this.slider(
        "subscriptionsPollMinutes",
        "Check every",
        "Minutes between checks, plus once when Obsidian starts. A channel feed only holds its last 15 videos, so a long gap between checks can lose the oldest of a burst for good.",
        [15, 360, 15],
      ),
      this.slider(
        "subscriptionsExpiryDays",
        "Forget unwatched videos after",
        "Days. Measured from the publish date. Only videos you never clicked are removed, and only from the hub — this never deletes a note. Zero keeps everything.",
        [0, 180, 5],
      ),
      this.slider(
        "tidyEmptyNoteDays",
        "Tidy empty notes after",
        "Days. Off at zero, which is where it starts. When on, a video note goes to the trash once you have played the video, that long has passed since, and there is still nothing under its Notes heading. The frontmatter, the description, the transcript and the most-replayed moments do not count — the plugin wrote those. Notes you never played are left alone, and so is anything open in front of you.",
        [0, 180, 5],
      ),
      {
        name: "Clear watch history",
        desc: "Deletes every video in the hub's History list and its watch time, on all your devices. Your notes and the hub are not touched. This can't be undone.",
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Clear history…")
              // `setDestructive` replaces this in 1.13; older versions lack it.
              .setWarning()
              .onClick(() => {
                new ConfirmClearHistoryModal(this.app, () => void plugin.history.clear()).open();
              }),
          ),
      },
      this.toggle(
        "subscriptionsIncludeShorts",
        "Include Shorts",
        "The feed mixes Shorts with normal videos and marks neither, so each new video is checked once to tell them apart. Off by default.",
        () => plugin.refreshHub(),
      ),
      {
        name: "Removed from search",
        desc: `${removedCount} ${removedCount === 1 ? "video" : "videos"}. Remove on a search result keeps it out of later searches on both devices. Undo any of them here.`,
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Show list…")
              .onClick(() =>
                new SearchBlocklistModal(this.app, plugin.subscriptions, "videos", () => this.redraw()).open(),
              ),
          ),
      },
      {
        name: "Hidden from search",
        desc: `${hiddenCount} ${hiddenCount === 1 ? "channel" : "channels"}. Hidden with the ⋯ on a search result. Only search is affected; subscribing to one un-hides it.`,
        build: (setting) =>
          setting.addButton((button) =>
            button
              .setButtonText("Show list…")
              .onClick(() =>
                new SearchBlocklistModal(this.app, plugin.subscriptions, "channels", () => this.redraw()).open(),
              ),
          ),
      },
    ];
  }

  private linkRows(): Row[] {
    return [
      this.toggle(
        "openYouTubeLinksHere",
        "Open YouTube links here",
        "A YouTube link clicked in a note opens in YT Free, at the link's timestamp, instead of the browser. Links from other apps reach Obsidian through obsidian://ytfree?url=… — the README has the Mac and iPhone setup.",
      ),
      {
        name: "Browser bookmarklet",
        desc: "Copies a bookmarklet that sends the YouTube tab you are on to YT Free. Make a new bookmark and paste this as its address.",
        build: (setting) =>
          setting.addButton((button) =>
            button.setButtonText("Copy").onClick(async () => {
              await navigator.clipboard.writeText(HANDOFF_BOOKMARKLET);
              new Notice("YT Free: bookmarklet copied.");
            }),
          ),
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
   * the device that polls: the settings are one file synced with the vault, and
   * a section that is invisible on the device you happen to be holding reads as
   * a missing feature rather than as a deliberate absence.
   */
  private notificationRows(): Row[] {
    const { plugin } = this;
    const report = (): void => this.setNotifyStatus(describeWebhook(plugin.hubSettings().notifications));
    return [
      {
        name: "Notification webhook",
        desc:
          "An https URL this plugin POSTs to when a check finds new videos — one message per check, never one per video. " +
          "Obsidian on iOS cannot raise a notification by itself, so the device running the check has to hand it to something that can: " +
          "ntfy.sh, Pushover, an Apple Shortcuts automation, anything that accepts a POST. Blank switches this off entirely.",
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
      this.toggle(
        "notificationsEnabled",
        "Send notifications",
        "Pause the messages without losing the URL. Off by default.",
        report,
      ),
      {
        name: "Message format",
        desc:
          "JSON carries the count, the channels, the titles and the video links — what a Shortcut or an automation wants. " +
          "Text sends the sentence on its own: choose it for ntfy.sh, which shows whatever you POST as the notification body.",
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
        name: "Send a test notification",
        desc: "Posts one message right now, so the URL can be proved without waiting for a channel to publish something.",
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

  private pinnedRows(): Row[] {
    const { plugin } = this;
    const repin = (): void => plugin.refreshPinnedPlayers();
    return [
      this.toggle(
        "pinnedPlayer",
        "Pin the player to the top of the note",
        "When a note's frontmatter points at a YouTube video, the full player — controls, speed, PiP, fullscreen — is mounted above the note body and stays there while you scroll. A ```ytfree block for the same video steps aside so you never get two players. Turned off, these notes keep a small Player button in the corner to bring it back.",
        repin,
      ),
      {
        name: "Frontmatter properties",
        desc: "Comma-separated, tried in order. The first one holding a YouTube URL wins.",
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("media_link, url")
              .setValue(plugin.settings.pinnedFrontmatterKeys)
              .onChange(async (value) => {
                plugin.settings.pinnedFrontmatterKeys = value;
                await plugin.saveSettings();
                repin();
              }),
          ),
      },
      this.slider(
        "pinnedHeightVh",
        "Pinned player height",
        "Percent of the window height. Fixed, so the note text below never moves. On a phone it is a ceiling: the picture keeps its shape and shrinks to fit, which is what stops a sideways phone handing the whole screen to the video.",
        [20, 70, 5],
        repin,
      ),
      this.toggle(
        "collapseProperties",
        "Collapse properties on video notes",
        "Fold the properties table when you open a note whose frontmatter names a video, so the player and your notes start at the top. Expanding it by hand sticks until you open another note.",
      ),
      this.toggle(
        "collapseSections",
        "Collapse description and transcript",
        "Open a video note with Notes showing and the description, transcript and most-replayed sections folded. Unfolding one sticks until you open another note.",
      ),
      this.toggle(
        "linkifyTimestamps",
        "Link timestamps in the note body",
        "Render bare times like 1:02:03 — the chapter list in a pasted description — as clickable seek links. Only on notes that name a video.",
      ),
    ];
  }

  private smartSpeedRows(): Row[] {
    const { plugin } = this;
    const refresh = (): void => plugin.refreshSmartSpeed();
    return [
      this.toggle(
        "smartSpeed",
        "Compress pauses",
        "Silence is jumped over rather than played fast, so there is nothing to hear where a pause was. Audio that is not speech but is not silence either — music, a demo — plays fast instead of being cut. Works on any captioned video with nothing installed, on desktop and on the phone. Every player has its own toggle in the control row; this is the state it starts in. Off by default.",
      ),
      this.toggle(
        "skipNonSpeech",
        "Skip non-speech audio",
        "Compress anything nobody is talking over — musical intros, interludes, stings — and not only what is literally silent. On, the caption timing and the ffmpeg measurement are combined: a stretch both call quiet is skipped outright, and one only the captions call quiet plays at the pause speed below, because there is audio there to hear. Turn it off to leave music at normal speed, which needs ffmpeg to tell music from silence.",
        refresh,
      ),
      {
        name: "Pause speed",
        desc: "How fast non-speech audio plays — music, and any pause too short or too far ahead of the buffer to jump over. Real silence is skipped instead, so this number never applies to it. Never slower than the speed you picked for the video itself.",
        build: (setting) =>
          setting.addDropdown((dropdown) => {
            for (const rate of [1.5, 2, 2.5, 3, 4]) dropdown.addOption(String(rate), `${rate}×`);
            dropdown.setValue(String(plugin.settings.silenceSpeed)).onChange(async (value) => {
              plugin.settings.silenceSpeed = Number(value);
              await plugin.saveSettings();
              refresh();
            });
          }),
      },
      {
        name: "Shortest pause to skip",
        desc: "A quiet stretch has to last at least this long to be compressed. Lower catches the breaths between sentences and saves more; higher only compresses the real gaps and is safer on a fast talker. One number for both engines — it is the caption-gap threshold, and it is exactly what ffmpeg's silence detection is given when ffmpeg is installed, so the setting means the same thing on every machine.",
        build: (setting) =>
          setting.addDropdown((dropdown) => {
            const options: Array<[number, string]> = [
              [0.4, "0.4 s — aggressive"],
              [0.5, "0.5 s — balanced"],
              [0.75, "0.75 s"],
              [1, "1 s"],
              [1.5, "1.5 s"],
              [2, "2 s — only long gaps"],
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

  private smartSpeedAdvancedRows(desktopApp: boolean): Row[] {
    const { plugin } = this;
    const rows: Row[] = [
      this.slider(
        "silenceWordPad",
        "Word protection",
        "How much room every spoken word is given, in seconds, before a skip is allowed to cross it. This is the guard that stops a word being swallowed when the volume-based detection is wrong about where the silence is. Zero turns it off.",
        [0, 0.5, 0.05],
        () => plugin.refreshSmartSpeed(),
      ),
    ];
    // Only meaningful where ffmpeg can exist. On a phone these would be dials
    // attached to nothing.
    if (!desktopApp) return rows;
    rows.push(
      this.slider(
        "silenceFloorMargin",
        "Floor margin (ffmpeg)",
        "How far above each video's measured noise floor the silence threshold sits, in dB. The threshold itself is measured per video from the first minute of audio — this only moves it. Higher compresses more and starts eating quiet speech; lower is the safe direction.",
        [2, 20, 1],
      ),
      {
        name: "Manual silence threshold (ffmpeg)",
        desc: "Overrides the measurement with a fixed dBFS value. Leave blank to measure each video, which is almost always better — a fixed number that suits one recording is inside the words on another. Enter a negative number, e.g. −40.",
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("measured")
              .setValue(plugin.settings.silenceNoiseDb === null ? "" : String(plugin.settings.silenceNoiseDb))
              .onChange(async (value) => {
                const parsed = Number(value.trim().replace(/[−–—]/g, "-"));
                plugin.settings.silenceNoiseDb = value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
                await plugin.saveSettings();
              }),
          ),
      },
    );
    return rows;
  }

  private transcriptRows(): Row[] {
    const { plugin } = this;
    return [
      this.toggle(
        "autoFetchTranscript",
        "Fetch automatically for new notes",
        "Notes created this session — from the template, the Web Clipper, or a tap in the hub — get their transcript without being asked, on the phone as well as the desktop. Replay peaks are added on desktop only. Opening an older note never triggers it; use the command for those.",
      ),
      this.slider(
        "transcriptIntervalSeconds",
        "Section length",
        "How much transcript sits under each seek link. Shorter means more precise links and a longer note. Any whole number of seconds — timestamps land on that grid: 20 gives 0:00, 0:20, 0:40.",
        [5, 180, 1],
      ),
      this.toggle(
        "followTranscript",
        "Follow the video",
        "Once you have gone to the transcript — with This moment, the Transcript button, or a tap on a paragraph — the note keeps up with the video, tinting the paragraph being spoken. Scrolling, typing or a tap anywhere else hands control back; going to the transcript again takes it up where the video is.",
        // Off means off now, not at the next note: something may be following
        // this second.
        (value) => {
          if (!value) plugin.stopFollowingTranscript();
        },
      ),
      this.slider(
        "heatmapPeaks",
        "Most-replayed moments",
        "How many replay peaks to list above the transcript, labelled with what is being said there. Zero turns the section off.",
        [0, 20, 1],
      ),
      {
        name: "Caption language",
        desc: "Language code to look for. Uploader-written captions are preferred over auto-generated ones when both exist.",
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
    ];
  }

  private flowRows(desktopApp: boolean): Row[] {
    const { plugin } = this;
    const resumeText = (ms: number): string =>
      `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")}s of no typing before playback starts again.`;
    const rows: Row[] = [
      this.toggle(
        "autoStampNewLine",
        "Timestamp every new line",
        "Once a video in the note has been played, the first character you type on a line brings its timestamp in with it. Works on the first line of a note, and whether the video is playing or paused. Turn off to use the Insert timestamp command instead.",
      ),
      this.slider(
        "lookbackSeconds",
        "Lookback",
        "How far before the moment you wrote a line its timestamp link should land, because you decide something is worth noting after you hear it. The timestamp still displays the time you wrote at — only the click target moves back. Applies to auto-stamps and to the command.",
        [0, 30, 1],
      ),
      this.toggle(
        "pauseWhileTyping",
        "Pause while typing",
        "Typing anywhere in a note with an active video pauses playback, so you never fall behind mid-sentence. A video you paused yourself is never resumed. The player's own pop-out can overrule this for one video without changing it here.",
      ),
      {
        // Seconds, because that is the unit the pause is felt in — "two seconds
        // of quiet before it starts again" is the sentence in your head, and
        // "2000" was a number you had to convert before you could judge it.
        // Still stored in milliseconds, which is what `setTimeout` wants and
        // what every existing `data.json` already holds.
        name: "Resume after",
        desc: resumeText(plugin.settings.resumeIdleMs),
        build: (setting) =>
          setting.addSlider((slider) =>
            slider
              .setLimits(0.25, 5, 0.25)
              .setValue(plugin.settings.resumeIdleMs / 1000)
              .setDynamicTooltip()
              .onChange(async (value) => {
                plugin.settings.resumeIdleMs = Math.round(value * 1000);
                setting.setDesc(resumeText(plugin.settings.resumeIdleMs));
                await plugin.saveSettings();
              }),
          ),
      },
    ];
    // Mobile only, and drawn only there: on a desktop the stream is resolved at
    // mount already, so the control would do nothing at all.
    if (!desktopApp) {
      rows.push(
        this.toggle(
          "warmOnOpen",
          "Get the video ready when a note opens",
          "Fetches the stream (not the video) as soon as a player appears, so Full screen, PiP and the transport work on the first press rather than the second. Off, nothing is fetched until you tap — the phone's own full screen then needs the video playing first.",
        ),
      );
    }
    return rows;
  }

  private troubleshootingRows(): Row[] {
    return [
      this.toggle(
        "debugLogs",
        "Log what the player is doing",
        "Prints the fullscreen and keyboard decisions to the developer console (Verbose level), which is the only way to see them: iOS refuses both silently when the tap that asked for them has already finished. Also adds the diagnostic commands (YouTube requests this session, dock badge) to the command palette. Turn on before reproducing a problem, and off afterwards.",
        () => this.plugin.refreshPinnedPlayers(),
      ),
    ];
  }

  /** yt-dlp, ffmpeg and where downloads go. Desktop only. */
  private helperRows(): Row[] {
    const { plugin } = this;
    const folderText = (): string => {
      const vaultPath = plugin.vaultPath();
      const chosen = plugin.settings.downloadFolder.trim();
      // A path inside the vault is the one mistake here that is expensive and
      // hard to undo, because the vault syncs. Say so at the moment it is made.
      const inVault = Boolean(chosen) && Boolean(vaultPath) && chosen.startsWith(vaultPath as string);
      return inVault
        ? "⚠ This folder is inside your vault. Downloads will sync to every device and count against your sync storage. Pick somewhere outside the vault."
        : "Where downloaded videos are kept. Blank means a “YT Free” folder in Movies (Videos on Windows and Linux). Outside the vault on purpose — these files are a local cache, not vault content.";
    };
    return [
      {
        name: "yt-dlp path",
        desc: "Leave blank to auto-detect. Obsidian does not inherit your shell PATH, so a full path may be needed.",
        aliases: ["download", "offline"],
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("Auto-detect")
              .setValue(plugin.settings.ytDlpPath)
              .onChange(async (value) => {
                plugin.settings.ytDlpPath = value.trim();
                plugin.resetResolver();
                await plugin.saveSettings();
              }),
          ),
      },
      {
        name: "ffmpeg path",
        desc: "Leave blank to auto-detect. Needed for downloads above 360p: YouTube only serves one ready-made file (360p), and everything better needs ffmpeg to join separate picture and sound. Streaming is unaffected — that reaches 1080p without ffmpeg.",
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("Auto-detect")
              .setValue(plugin.settings.ffmpegPath)
              .onChange(async (value) => {
                plugin.settings.ffmpegPath = value.trim();
                plugin.resetFfmpeg();
                await plugin.saveSettings();
              }),
          ),
      },
      {
        name: "Download folder",
        desc: folderText(),
        aliases: ["offline"],
        build: (setting) =>
          setting.addText((text) =>
            text
              .setPlaceholder("Movies/YT Free")
              .setValue(plugin.settings.downloadFolder)
              .onChange(async (value) => {
                // Blank stays blank and means the default — which cannot be
                // spelled out in the defaults, because it needs `os.homedir()`.
                plugin.settings.downloadFolder = value.trim();
                await plugin.saveSettings();
                setting.setDesc(folderText());
              }),
          ),
      },
    ];
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
      .addButton((button) =>
        button
          .setButtonText("Clear history")
          .setWarning()
          .onClick(() => {
            this.onConfirm();
            this.close();
          }),
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
