/**
 * The settings: their shape, their defaults, and the check every `data.json`
 * passes through on load.
 *
 * Pure and platform-neutral (no `obsidian` import), so the check is testable
 * under plain `node --test`. The settings tab itself is still in `main.ts`.
 */

import type { NotificationFormat } from "./notify.ts";
import { FLOOR_MARGIN_DB, MIN_SILENCE_GAP, WORD_PAD } from "./silence.ts";
import { DEFAULT_TIDY_DAYS } from "./tidy.ts";

export interface YtFreeSettings {
  ytDlpPath: string;
  /**
   * Developer only, set by hand in `data.json`: a folder made by
   * `tools/make-offline-hd.mjs`. Every video then plays from it, 360p and HD,
   * with no request to YouTube (GitHub #38). Not in the settings tab.
   */
  devOfflineHd?: string;
  upgradeToHighQuality: boolean;
  /** Stitched HD on the phone. Off by default: iOS 17.1+, and more data. */
  phoneHighQuality: boolean;
  /** Hold playback until HD is ready, and start it on the top rung. */
  startInHd: boolean;
  timestampFormat: string;
  autoStampNewLine: boolean;
  lookbackSeconds: number;
  pauseWhileTyping: boolean;
  resumeIdleMs: number;
  pinnedPlayer: boolean;
  pinnedHeightVh: number;
  pinnedFrontmatterKeys: string;
  /** YouTube links clicked in a note open in YT Free, not the browser (GitHub #3). */
  openYouTubeLinksHere: boolean;
  collapseProperties: boolean;
  collapseSections: boolean;
  linkifyTimestamps: boolean;
  transcriptLanguage: string;
  transcriptIntervalSeconds: number;
  /**
   * Whether the note's transcript keeps up with the video once you have gone to
   * it — see `startFollowing`. Off means the jump is a jump and nothing moves
   * afterwards, which is what this was before 035.
   */
  followTranscript: boolean;
  autoFetchTranscript: boolean;
  heatmapPeaks: number;
  downloadFolder: string;
  ffmpegPath: string;
  subscriptionsPollMinutes: number;
  subscriptionsExpiryDays: number;
  subscriptionsIncludeShorts: boolean;
  /**
   * Where a poll POSTs when new videos land in the Inbox. Blank is the default
   * and switches the whole feature off.
   *
   * Deliberately a bare URL rather than a provider integration: Obsidian mobile
   * cannot raise an iOS notification itself, so *something* off-device has to,
   * and which something is not ours to choose. ntfy.sh, Pushover, an Apple
   * Shortcut — all of them take a plain POST. See
   * `docs/V1-SCOPE-NOTIFICATIONS.md`.
   */
  notificationWebhook: string;
  /** Pause the pushes without having to delete the URL to do it. */
  notificationsEnabled: boolean;
  /**
   * `json` for anything that parses a body; `text` for ntfy.sh, which renders
   * the request body verbatim on the lock screen.
   */
  notificationFormat: NotificationFormat;
  /**
   * Days a watched video note may sit with nothing written in it before it is
   * moved to the trash. Zero switches the sweep off entirely. See `tidy.ts` for
   * the four conditions a note has to meet before this number is even consulted.
   */
  tidyEmptyNoteDays: number;
  watchLaterFolder: string;
  /** Smart Speed's starting state on a freshly opened player. */
  smartSpeed: boolean;
  /**
   * How fast non-speech audio plays, when Smart Speed is on.
   *
   * Since 017 this is no longer what happens to silence — silence is seeked
   * over. It applies to music, and to the pauses a seek would make worse than
   * it found them: shorter than `MIN_SKIP_SECONDS`, or past the buffer.
   */
  silenceSpeed: number;
  /**
   * How long a quiet stretch has to be before it counts as a skippable pause.
   *
   * One number for both producers, deliberately: it is the transcript
   * producer's gap threshold *and* silencedetect's `d=`, so turning the dial
   * changes the same thing whether or not ffmpeg happens to be installed. Two
   * numbers here would mean the feature behaved differently on two machines for
   * a reason the user never chose.
   */
  silenceMinGap: number;
  /**
   * A manual `silencedetect` threshold in dBFS, or `null` to measure the audio.
   *
   * `null` by default, and 022 is why: this was a fixed −30 dB, which is inside
   * the words on a normally-mastered voice track, so the player skipped the
   * gaps between syllables. Every recording has its own noise floor, so the
   * threshold is now measured per video — see `pickThreshold`. The setting
   * survives as an Advanced escape hatch for audio the measurement gets wrong.
   */
  silenceNoiseDb: number | null;
  /**
   * How far above the measured noise floor the threshold sits, in dB.
   *
   * Advanced. Raising it compresses more and risks clipping quiet speech;
   * lowering it is the safe direction. See `FLOOR_MARGIN_DB`.
   */
  silenceFloorMargin: number;
  /**
   * How much room each spoken word is given, on both sides, before a skip is
   * allowed to cross it. Seconds. See `vetoWords`.
   *
   * Advanced, and warned about: it is the one number here whose *lower* end
   * makes the plugin skip more and clip words. Zero disables the veto.
   */
  silenceWordPad: number;
  /**
   * Compress everything with no *speech* in it, rather than only what is
   * literally silent.
   *
   * The setting 015 did not have, and the one BarkernotBob asked for after using it:
   * *"Musical interludes should still be cut … the idea is to let this get you
   * straight to the content, cutting the fluff."* On, the two producers are
   * unioned; off, ffmpeg's measurement wins where it has run, which is 015's
   * behaviour and the answer for someone who wants the music left alone.
   */
  skipNonSpeech: boolean;
  /**
   * Print what the phone is actually doing, to the console.
   *
   * Off, and not a preference — a switch for one job. Two of the bugs this
   * plugin has had (038, 041) are the same invisible failure: iOS declines a
   * fullscreen or a keyboard because the user gesture has lapsed, and declines
   * it *silently*. Nothing about that can be reasoned out from a screenshot, so
   * the alternative to this toggle is guessing. See `debug`.
   */
  debugLogs: boolean;
  /**
   * Phone only: resolve the stream when the player mounts, instead of waiting
   * for the first tap.
   *
   * `deferMobileLoad` exists because opening a note should not cost a video,
   * and that is still true of the *video* — this fetches metadata, not the
   * film. What it buys is 038: `webkitEnterFullscreen` is refused until there
   * is loaded media, and the resolve cannot happen inside the tap that wants
   * fullscreen, so the only way the first press can be the real thing is for
   * the resolve to have already happened. Off by default since GitHub #66:
   * a resolve on every note opened is a YouTube request nobody asked for, and
   * keeping a user's IP unflagged outranks a first-press fullscreen. On for
   * anyone who wants 038's behaviour back.
   */
  warmOnOpen: boolean;
}

export const DEFAULT_SETTINGS: YtFreeSettings = {
  ytDlpPath: "",
  upgradeToHighQuality: true,
  phoneHighQuality: false,
  startInHd: false,
  timestampFormat: "[{ts}]({link}) ",
  autoStampNewLine: true,
  lookbackSeconds: 5,
  pauseWhileTyping: true,
  resumeIdleMs: 2000,
  pinnedPlayer: true,
  pinnedHeightVh: 40,
  pinnedFrontmatterKeys: "media_link, url",
  openYouTubeLinksHere: true,
  collapseProperties: true,
  collapseSections: true,
  linkifyTimestamps: true,
  transcriptLanguage: "en",
  // 20, not the 60 this shipped with: a peak's jump lands on a paragraph, so
  // the paragraph is how close the jump can get. Notes written before this
  // keep whatever they were built with.
  transcriptIntervalSeconds: 20,
  followTranscript: true,
  // Stays on (GitHub #66 weighed it): one caption fetch per note you create,
  // never per note opened, and it already waits out a bot-check pause and the
  // hourly background cap.
  autoFetchTranscript: true,
  heatmapPeaks: 8,
  // Blank means "wherever `defaultDownloadFolder()` says", which is
  // ~/Movies/YT Free — deliberately outside the vault, because the vault is in
  // iCloud and a 700MB video inside it would sync to every device. It cannot be
  // spelled out here: `os.homedir()` is unreachable at module load on mobile.
  downloadFolder: "",
  ffmpegPath: "",
  // Hourly. #66 weighed two hours and kept one: feed traffic was measured
  // safe (tools/feed-torture.ts), and a feed only holds its last 15 videos.
  subscriptionsPollMinutes: 60,
  subscriptionsExpiryDays: 0,
  subscriptionsIncludeShorts: false,
  // Off, and blank. A plugin that starts POSTing somewhere on its own would be
  // a different kind of software than this one.
  notificationWebhook: "",
  notificationsEnabled: false,
  notificationFormat: "json",
  // Off for a new install (Isaiah, 2026-11-10): a plugin should not remove
  // notes nobody asked it to. `sanitizeSettings` keeps 30 for older installs.
  tidyEmptyNoteDays: 0,
  watchLaterFolder: "Watch Later",
  // On by default. It is the feature, not an option about the feature — and it
  // announces itself honestly: the toggle is lit in the control row and the
  // time saved counts up inside it, so nobody has to wonder why a video sounds
  // tighter than it did.
  // Off for a new install (Isaiah, 2026-11-10). `sanitizeSettings` keeps it on
  // for an install that was already running with the old default.
  smartSpeed: false,
  silenceSpeed: 3,
  silenceMinGap: 0.5,
  silenceNoiseDb: null,
  silenceFloorMargin: FLOOR_MARGIN_DB,
  silenceWordPad: WORD_PAD,
  skipNonSpeech: true,
  debugLogs: false,
  // Off (GitHub #66): nothing goes to YouTube before Play. See the field.
  warmOnOpen: false,
};

/** Numbers that may be negative. Every other number setting is a size, a count or a time. */
const SIGNED: ReadonlySet<string> = new Set(["silenceNoiseDb"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is `value` usable for the setting `key`, judged against that key's default? */
function fits(key: string, value: unknown, fallback: unknown): boolean {
  if (key === "silenceNoiseDb") return value === null || (typeof value === "number" && Number.isFinite(value));
  if (key === "notificationFormat") return value === "json" || value === "text";
  if (typeof fallback === "number") {
    return typeof value === "number" && Number.isFinite(value) && (SIGNED.has(key) || value >= 0);
  }
  return typeof value === typeof fallback;
}

/**
 * What `data.json` held, made safe to run on.
 *
 * `data.json` is a file: an older build wrote it, another device's newer build
 * may have, and people edit it by hand. A setting of the wrong type goes back
 * to its default rather than into the player. Keys this build does not know
 * are kept, not dropped: they belong to a newer build on another device, or to
 * a clean-up that still needs to see them (the removed sign-in, GitHub #64).
 *
 * `null` (no file) is a new install and gets the defaults as they are. A file
 * from before 2026-11-10 that never wrote `tidyEmptyNoteDays` or `smartSpeed`
 * keeps the 30 days and the Smart Speed it was running with.
 */
export function sanitizeSettings(saved: unknown): YtFreeSettings {
  if (!isRecord(saved)) return { ...DEFAULT_SETTINGS };
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...saved };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!fits(key, out[key], fallback)) out[key] = fallback;
  }
  if (out.devOfflineHd !== undefined && typeof out.devOfflineHd !== "string") delete out.devOfflineHd;
  // Defaults that changed on 2026-11-10. A file that never wrote the key was
  // running on the old default, and keeps it.
  if (!("tidyEmptyNoteDays" in saved)) out.tidyEmptyNoteDays = DEFAULT_TIDY_DAYS;
  if (!("smartSpeed" in saved)) out.smartSpeed = true;
  const settings = out as unknown as YtFreeSettings;
  // 022 raised the floor of "shortest pause to skip" to 0.4 s. Below that a
  // pause is a breath between words rather than a gap between thoughts, and
  // the map fills with fragments too short for the player to do anything with.
  // A user sitting on the old 0.2 or 0.3 is moved up rather than left on a
  // setting the UI no longer offers.
  if (settings.silenceMinGap < MIN_SILENCE_GAP) settings.silenceMinGap = MIN_SILENCE_GAP;
  // Zero here is a divide or a player that never moves, not a preference.
  if (settings.silenceSpeed <= 0) settings.silenceSpeed = DEFAULT_SETTINGS.silenceSpeed;
  if (settings.pinnedHeightVh <= 0) settings.pinnedHeightVh = DEFAULT_SETTINGS.pinnedHeightVh;
  if (settings.subscriptionsPollMinutes <= 0) {
    settings.subscriptionsPollMinutes = DEFAULT_SETTINGS.subscriptionsPollMinutes;
  }
  return settings;
}
