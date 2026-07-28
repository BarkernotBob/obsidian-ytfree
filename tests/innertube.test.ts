/**
 * The InnerTube parser, against recorded responses.
 *
 * These fixtures are real captures, not hand-written JSON — see
 * `spikes/innertube/record.mjs`. That matters because the only thing that can
 * really break this parser is YouTube changing the shape of the response, and a
 * fixture I wrote myself can only ever confirm my own idea of the shape.
 *
 * The `ip=` parameter is redacted out of every URL and the signed URLs are long
 * dead; nothing here reaches the network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hlsManifest,
  MobileResolveError,
  pickMuxedFormat,
  playabilityFailure,
  toStream,
} from "../src/mobile/player-response.ts";
import type { PlayerResponse } from "../src/mobile/player-response.ts";
import { EXPIRY_SAFETY_MARGIN_MS } from "../src/stream.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): PlayerResponse {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as PlayerResponse;
}

const androidOk = fixture("player-android-ok.json");
const iosHls = fixture("player-ios-hls.json");
const loginRequired = fixture("player-login-required.json");
const unavailable = fixture("player-unavailable.json");

// -------------------------------------------------------------- itag 18 present

test("an ordinary video yields the muxed 360p URL", () => {
  assert.equal(playabilityFailure(androidOk), null);

  const url = pickMuxedFormat(androidOk);
  assert.ok(url, "itag 18 missing from the ANDROID response — the whole plan rests on it");
  assert.ok(url.startsWith("https://"));
  assert.match(url, /itag=18/);
});

test("the resolved stream carries an expiry pulled back from the URL", () => {
  const url = pickMuxedFormat(androidOk) as string;
  const stream = toStream(url, false);

  assert.equal(stream.url, url);
  assert.equal(stream.isHls, false);
  // 360p is all this resolver can reach, so the mode is never "quality".
  assert.equal(stream.mode, "fast");

  const expire = Number(new URL(url).searchParams.get("expire")) * 1000;
  assert.equal(stream.expiresAt, expire - EXPIRY_SAFETY_MARGIN_MS);
  assert.ok(stream.expiresAt < expire, "the safety margin has to pull the expiry earlier");
});

test("a ciphered format is refused rather than unwrapped", () => {
  // Never observed in ten measured videos, but if it starts happening the right
  // outcome is a clean fallback, not a crypto layer growing inside the vault.
  const ciphered: PlayerResponse = {
    playabilityStatus: { status: "OK" },
    streamingData: { formats: [{ itag: 18, signatureCipher: "s=abc&sp=sig&url=https://x" }] },
  };
  assert.equal(pickMuxedFormat(ciphered), null);
});

// ------------------------------------------- itag 18 absent, HLS manifest present

test("with no itag 18 the IOS HLS manifest is the fallback", () => {
  assert.equal(playabilityFailure(iosHls), null);
  assert.equal(pickMuxedFormat(iosHls), null, "fixture is only interesting without itag 18");

  const manifest = hlsManifest(iosHls);
  assert.ok(manifest);
  assert.match(manifest, /^https:\/\/manifest\.googlevideo\.com\//);

  const stream = toStream(manifest, true);
  assert.equal(stream.isHls, true);
  // Manifest URLs spell the expiry as a path segment, not a query parameter.
  assert.ok(stream.expiresAt > 0, "path-form expiry was not parsed");
});

// ---------------------------------------------------------------- neither present

test("a playable video with no usable format yields neither", () => {
  // Derived from the IOS capture by dropping its manifest: the shape is real,
  // the absence is the part being tested.
  const stripped: PlayerResponse = {
    ...iosHls,
    streamingData: { ...iosHls.streamingData, hlsManifestUrl: undefined },
  };

  assert.equal(playabilityFailure(stripped), null);
  assert.equal(pickMuxedFormat(stripped), null);
  assert.equal(hlsManifest(stripped), null);
});

test("an empty response is a failure, not a silent null", () => {
  const problem = playabilityFailure({});
  assert.ok(problem instanceof MobileResolveError);
  assert.equal(problem.kind, "unplayable");
});

// ------------------------------------------------------------------ LOGIN_REQUIRED

test("an age-restricted video reports the login failure and YouTube's own reason", () => {
  const problem = playabilityFailure(loginRequired);
  assert.ok(problem instanceof MobileResolveError);
  assert.equal(problem.kind, "login");
  // The reason is what the user sees in the fallback notice, so it comes from
  // YouTube rather than from a guess of ours.
  assert.equal(problem.message, "This video may be inappropriate for some users.");
  assert.equal(pickMuxedFormat(loginRequired), null);
});

test("LOGIN_REQUIRED with no reason still explains itself", () => {
  const problem = playabilityFailure({ playabilityStatus: { status: "LOGIN_REQUIRED" } });
  assert.equal(problem?.kind, "login");
  assert.match(problem?.message ?? "", /signed-in account/);
});

test("a removed video is unplayable rather than a login problem", () => {
  const problem = playabilityFailure(unavailable);
  assert.equal(problem?.kind, "unplayable");
  assert.equal(problem?.message, "This video is unavailable");
});

test("an unknown status falls back to the status string itself", () => {
  const problem = playabilityFailure({ playabilityStatus: { status: "SOMETHING_NEW" } });
  assert.equal(problem?.kind, "unplayable");
  assert.equal(problem?.message, "SOMETHING_NEW");
});
