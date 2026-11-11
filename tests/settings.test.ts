import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/settings.ts";
import { MIN_SILENCE_GAP } from "../src/silence.ts";

test("a new install gets the defaults, with the note tidy off", () => {
  for (const nothing of [null, undefined, "x", 3, []]) {
    assert.deepEqual(sanitizeSettings(nothing), DEFAULT_SETTINGS);
  }
  assert.equal(DEFAULT_SETTINGS.tidyEmptyNoteDays, 0);
  // A copy: the plugin writes into its settings, never into the defaults.
  assert.notEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
});

test("an install from before the tidy default changed keeps its 30 days", () => {
  assert.equal(sanitizeSettings({ smartSpeed: false }).tidyEmptyNoteDays, 30);
  assert.equal(sanitizeSettings({}).tidyEmptyNoteDays, 30);
});

test("Smart Speed is off for a new install and stays on for an older one", () => {
  assert.equal(sanitizeSettings(null).smartSpeed, false);
  assert.equal(sanitizeSettings({ tidyEmptyNoteDays: 30 }).smartSpeed, true);
  assert.equal(sanitizeSettings({ smartSpeed: false }).smartSpeed, false);
});

test("a tidy setting the user chose is kept, zero included", () => {
  assert.equal(sanitizeSettings({ tidyEmptyNoteDays: 0 }).tidyEmptyNoteDays, 0);
  assert.equal(sanitizeSettings({ tidyEmptyNoteDays: 90 }).tidyEmptyNoteDays, 90);
});

test("saved values of the right type are kept", () => {
  const saved = {
    ytDlpPath: "/x/yt-dlp",
    smartSpeed: false,
    pinnedHeightVh: 55,
    silenceNoiseDb: -42,
    notificationFormat: "text",
    tidyEmptyNoteDays: 10,
  };
  const got = sanitizeSettings(saved);
  for (const [key, value] of Object.entries(saved)) {
    assert.equal((got as unknown as Record<string, unknown>)[key], value, key);
  }
});

test("a value of the wrong type goes back to its default", () => {
  const got = sanitizeSettings({
    ytDlpPath: 7,
    smartSpeed: "yes",
    pinnedHeightVh: "40",
    lookbackSeconds: Number.NaN,
    heatmapPeaks: -3,
    silenceNoiseDb: "quiet",
    notificationFormat: "xml",
    notificationWebhook: null,
    tidyEmptyNoteDays: "30",
  });
  assert.equal(got.ytDlpPath, DEFAULT_SETTINGS.ytDlpPath);
  assert.equal(got.smartSpeed, DEFAULT_SETTINGS.smartSpeed);
  assert.equal(got.smartSpeed, false);
  assert.equal(got.pinnedHeightVh, DEFAULT_SETTINGS.pinnedHeightVh);
  assert.equal(got.lookbackSeconds, DEFAULT_SETTINGS.lookbackSeconds);
  assert.equal(got.heatmapPeaks, DEFAULT_SETTINGS.heatmapPeaks);
  assert.equal(got.silenceNoiseDb, null);
  assert.equal(got.notificationFormat, "json");
  assert.equal(got.notificationWebhook, "");
  // Present but unreadable: the new default, off. Never a guess that trashes notes.
  assert.equal(got.tidyEmptyNoteDays, 0);
});

test("numbers that would stall the player or the poll are refused", () => {
  const got = sanitizeSettings({ silenceSpeed: 0, pinnedHeightVh: 0, subscriptionsPollMinutes: 0, silenceMinGap: 0.2 });
  assert.equal(got.silenceSpeed, DEFAULT_SETTINGS.silenceSpeed);
  assert.equal(got.pinnedHeightVh, DEFAULT_SETTINGS.pinnedHeightVh);
  assert.equal(got.subscriptionsPollMinutes, DEFAULT_SETTINGS.subscriptionsPollMinutes);
  assert.equal(got.silenceMinGap, MIN_SILENCE_GAP);
});

test("keys this build does not know are kept for whoever does", () => {
  const got = sanitizeSettings({ accountCookieFile: "~/c.txt", fromANewerBuild: { a: 1 } }) as unknown as Record<
    string,
    unknown
  >;
  assert.equal(got.accountCookieFile, "~/c.txt");
  assert.deepEqual(got.fromANewerBuild, { a: 1 });
});

test("the developer's offline folder survives only as text", () => {
  assert.equal(sanitizeSettings({ devOfflineHd: "/tmp/hd" }).devOfflineHd, "/tmp/hd");
  assert.equal("devOfflineHd" in sanitizeSettings({ devOfflineHd: 5 }), false);
});
