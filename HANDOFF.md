# HANDOFF

## Status — 2026-07-28: issue 006 approved, gate spiked and passed, not built

Sign in to YouTube from inside Obsidian and import subscriptions, Watch Later
and history. Scope is `docs/V1-SCOPE-ACCOUNT-IMPORT.md`, **approved 2026-07-28**.
No implementation code exists yet.

### Why this exists at all

BarkernotBob asked for a hybrid: the account pulls **data** in, but playback stays
anonymous so nothing watched in Obsidian is attributed to his YouTube account.
He accepted that Obsidian views will not appear in his watch history, and
accepted that members-only and age-restricted videos stay unplayable here.

He explicitly refused `--cookies-from-browser`: **"I don't want you pulling from
my browser at all. I want to be able to click to sign-in."** No reading of
Chrome/Arc/Safari cookie stores, ever. That constraint is what forced an in-app
sign-in window rather than the much easier browser-cookie route.

### What is settled

- **OAuth cannot do this.** `watchHistory` and `watchLater` were deprecated on
  the channel resource in Aug 2016 and return literal `HL`/`WL`. The Data API
  gives subscriptions and neither of the other two. Cookies are the only
  mechanism that meets the request. Don't re-litigate this — it was researched.
- **The gate is clear.** Spiked on `prototype/signin-spike`; findings are in
  that branch's `prototypes/signin-spike/README.md`, which is worth reading
  before writing the sign-in code.

| Tried | Result |
|---|---|
| `BrowserWindow` + UA spoofed to Chrome 142, at `accounts.google.com/ServiceLogin` | **blocked** |
| `<webview>` in a Modal, **UA untouched**, at `youtube.com` | **signed in, first try** |

Three rules follow, and they are the reason the spike was worth running:

1. **Never spoof the user agent.** It is the one change that produced a block.
2. **No client-hint rewriting.** Built during the spike, never needed, deleted.
3. **`<webview>` in a Modal, pointed at `youtube.com`** — sign in from the avatar
   menu. Never navigate to `ServiceLogin`; that is where the check lives.
   Media Extended's v3 `apps/app/src/login/modal.ts` is the reference shape.

Remote module is `require("@electron/remote")`.

### What is NOT settled — and it is step 1

**Whether the session cookies can be read back out of the partition, and whether
yt-dlp accepts them for `:ytsubs`.** The spike was removed before those commands
ran. Do this before writing any UI: sign in, dump cookies to a Netscape file,
run `yt-dlp --cookies FILE --flat-playlist --playlist-end 5 :ytsubs`. If it
fails, the rest of the scope is dead and the Takeout CSV stays the only way in.

### Standing constraints for this issue

- The cookie file lives **outside the vault**, mode `600`. The vault is in
  iCloud; a live Google session must not sync to two Macs and Apple's servers.
- A captured session cookie is **unscoped full Google account access**, not a
  scoped token. BarkernotBob was told this and accepted it.
- yt-dlp warns that recurring authenticated requests can get an account flagged.
  BarkernotBob was told this twice, chose to proceed, and it is recorded in the scope
  so it is not rediscovered later as a bug. Mitigations are the 12h default and
  stop-on-expiry. Do not silently increase the poll rate.
- Cookies go on account-data calls **only**. Never on playback, stream
  resolution, RSS polling, transcripts or downloads. That split is the feature.

### Spike cleanup already done

Vault plugin folder, the 59 MB Electron partition holding the live session, and
the cookie directory are all deleted. `prototype/signin-spike` is pushed and
stays as the record; it never merges. Note `.obsidian/plugins/ytfree-spike/`
(the 004 mobile-iframe spike) was **left alone** — it belongs to 004 and was not
mine to remove.

## Status — 2026-07-28 (latest): issue 004 built — mobile viewer

Issue 004 is **built and installed**. 123 unit tests pass, build clean.
**Awaiting the manual test** at the bottom of `issues/004-mobile-viewer.md`.

**Say this plainly to BarkernotBob: none of the iOS behaviour has been run on a real
iPhone.** What is actually verified is narrower than "it works on mobile":

- the bundle contains **no Node builtin `require` that runs at load** (checked on
  `main.js`, and now enforced by the build itself — see below);
- the InnerTube parser is tested against **real captured responses**, not
  hand-written JSON;
- desktop still passes everything it passed before.

What is *not* verified: whether `requestUrl`'s custom User-Agent reaches YouTube
from iOS (risk 1 in the issue), and whether WKWebView will load a googlevideo URL
into a `<video>` element (risk 2). Both are step B4 of the manual test. If B4
fails, the whole approach is in question, not a detail of it.

### The shape of the change

Everything that touches Node moved under `src/desktop/` behind **one door**:
`await import("./desktop")`, inside a `Platform.isDesktopApp` branch. esbuild
keeps a dynamically-imported subgraph in a lazily-initialised closure, so the
`require` calls happen on first use rather than at startup — which is the whole
game, because on iOS a top-level `require("child_process")` throws *before*
`onload`, so the plugin dies rather than degrading.

- `src/stream.ts` — the platform-neutral core (`extractVideoId`, `parseExpiry`,
  `StreamCache`, the `ResolvedStream` shape). Imports nothing.
- `src/desktop/` — `resolver.ts` (yt-dlp), `download.ts`, `transcript-fetch.ts`,
  `shorts-probe.ts`, and `index.ts` as the only entry point.
- `src/mobile/innertube.ts` — the request. `src/mobile/player-response.ts` — the
  parsing, split out purely so the tests can run it without `obsidian`.
- `manifest.json` lost `isDesktopOnly`.

### The build now enforces the rule that matters

`esbuild.config.mjs` fails the production build if any Node builtin is required
in the eager module body. This is the highest-value thing in the change: one
ordinary top-level import in a file mobile loads pulls the whole desktop subgraph
back into startup, the source diff looks completely innocent, and the only
symptom is the plugin refusing to load on a phone you are not holding. Verified
by deliberately introducing a leak — the build failed with the right message.

### Four things worth knowing before touching this again

- **Issue 004's list of Node imports was incomplete.** `src/subscriptions.ts`
  also imported `https`, for the Shorts probe, and it sits directly on the mobile
  load path. Mobile now leaves `isShort` null, which already meant "ask again
  later". Do not trust a hand-written list of imports over the build guard.
- **`DEFAULT_SETTINGS.downloadFolder` used to call `os.homedir()` at module
  scope** — a Node call at load time, exactly the failure being fixed. It is now
  `""`, meaning "the default", resolved lazily via `defaultDownloadFolder()`.
- **Mobile defers the resolve until you tap.** The player mounts with its final
  height reserved and a thumbnail poster; nothing is fetched until a tap on the
  poster or on a timestamp. Opening a note should not cost a video.
- **`player.primeForGesture()` exists for one iOS rule**: `play()` after an
  `await` is refused as not user-initiated. Touching the element synchronously
  inside the tap handler claims the gesture and survives the later `src` swap.
  This is anticipated, not observed — if playback needs a second tap on the
  device, this is the code to look at first.

### Fixtures

`tests/fixtures/*.json` are real captures, re-recordable with
`node spikes/innertube/record.mjs`. The `ip=` parameter is redacted in both the
query form and the `/ip/…` path form used by manifest URLs. The signed URLs
expire in about six hours, which is fine — nothing in the tests fetches them.

`node spikes/innertube/probe.mjs` remains the load-bearing measurement: green
means InnerTube still hands out unciphered, playable URLs. Run it first if mobile
playback ever stops working.

## Status — 2026-07-27: subscriptions hub built

Issue 003 is **built and installed**. 113 unit tests and 7 live smoke tests
pass, build clean. **Awaiting the 18-step manual test** at the bottom of
`docs/V1-SCOPE-SUBSCRIPTIONS.md`.

Subscribed channels are polled on a schedule, new videos land in a hub view, and
clicking one turns it into a Watch Later note with the player already pinned.
Nothing here replaces RSS Dashboard for podcasts — only the YouTube half.

- `src/subscriptions.ts` — all the rules, no Obsidian: feed parsing, the Takeout
  CSV, merge, expiry, the note shape, the Shorts probe. 30 tests.
- `src/hub.ts` — the state file, the poller, the view, the import dialog.
- Storage is `.obsidian/plugins/ytfree/subscriptions.json`, deliberately not
  `data.json`: the index runs to thousands of rows and a poll should not rewrite
  the settings file.

### Three findings that only showed up against live data
- **The feed header's `<yt:channelId>` drops the `UC` prefix**, while the same
  tag inside an entry keeps it. The live smoke test caught this; nothing written
  from the spec would have. The parser reads the ID off the self link instead.
- **A nonexistent video ID answers 200 to the `/shorts/<id>` probe**, same as a
  real Short. So "200 means Short" only holds for IDs that came from a feed, and
  any other status is recorded as "unknown, ask again" — never as long-form.
- **Expiry runs before the Shorts probe.** On a first import that is the
  difference between a few dozen HTTP requests and fifteen hundred.

### Decisions worth keeping
- **Clicking a video does not remove its card.** Under the New filter, marking an
  item Kept would drop it out of the list and pull everything below it upward —
  the reflow-on-click the global rule forbids. The card stays put and only its
  marker changes; the list re-filters on the next refresh, poll or filter change.
- **Descriptions are cached at poll time**, which is the hub's whole reason to
  exist over an RSS reader. The feed is a rolling 15-entry window; by the time
  you click, the video may have fallen out of it.
- **Expiry is measured from the publish date, not from when we first saw it.** A
  fresh import then trims itself to the last 30 days instead of dumping every
  channel's whole window into the hub, and "30 days" means the same thing on
  both Macs.
- **Expiry never touches a file.** It removes a row from a JSON index. Kept items
  are exempt, and deleting a note by hand does not resurrect the item.
- **Re-importing Takeout never removes a channel.** Unsubscribing on YouTube is
  not a statement about what you want to keep seeing here.
- **The poll ticker asks "is it due yet" every minute** rather than being an
  interval set to the poll period, so changing the period in settings takes
  effect immediately rather than at the next restart. Poll-on-load is skipped if
  the last poll was under five minutes ago.
- **The Takeout CSV is parsed by header name with a positional fallback.** The
  exact column names were never verified against a real export, and an
  unrecognised header must not silently import zero channels.

### Known limitation, documented rather than fixed
The 15-entry window has no backfill. If Obsidian stays closed longer than a
channel takes to publish 15 videos, those videos are missed permanently.
Polling on startup narrows it; nothing closes it.

## Status — 2026-07-27 (transcript auto-fetch): mobile re-scoped, nothing built

**Start the next session here.** Nothing in `src/` changed. Two issues were
rewritten, one spike was added, and the mobile plan changed shape entirely.

### What changed and why

The iframe route is dead and the GitHub Pages shim is rejected. **Mobile will
resolve the stream in the plugin and play it in a plain `<video>` element** — the
same thing desktop does, with InnerTube standing in for yt-dlp.

- **The error-153 confound is closed.** oEmbed returns `200` for `h0EGCnBjTVk`,
  so embedding is *enabled* and the embed still refused to play. The cause is
  `capacitor://localhost` not being an http(s) origin, and nothing the plugin
  passes can fix that.
- **InnerTube returns unciphered, playable URLs.** Measured 10/10: status OK,
  zero `signatureCipher` formats, itag 18 (360p muxed) on every video, and those
  URLs serve bytes with no PO token. No `base.js`, no eval, no crypto — which is
  what makes this a different proposition from the "reimplement yt-dlp" that the
  old issue 004 correctly rejected.
- **Mobile therefore ends up ad-free**, plus native PiP, AirPlay, background
  audio, and lock-screen transport.
- **HLS is gone** (1 of 10 videos) and `dashManifestUrl` never appears on any
  client version 17.x–20.x. Do not design around either.

### The split

- **[Issue 004](issues/004-mobile-viewer.md) — v1, 360p.** itag 18 into a
  `<video>`, docked at the top of the note. Seeking becomes
  `video.currentTime = secs`, which deletes the whole postMessage handshake.
- **[Issue 005](issues/005-mobile-full-quality.md) — v2, full quality.** Separate
  video/audio streams, so MSE, a synthesized manifest, and a custom loader
  (googlevideo sends no `Access-Control-Allow-Origin`, so plain `fetch` is
  blocked). iOS 17.1 floor via `ManagedMediaSource`.

360p ships first on purpose: the risk in 004 is not the resolver, it is getting
the plugin to load on iOS at all — every Node import is currently top-level and
throws at module load. That work should not wait behind a media-engine project.

### Next step

1. `node spikes/innertube/probe.mjs` — five seconds, and the entire plan rests on
   it. Baseline 2026-07-27 is 10/10 PASS.
2. Then §1 of issue 004: `src/desktop/`, the new `src/stream.ts`, drop
   `isDesktopOnly`. Desktop must not change behaviour.

Open call for 005, not yet made: spike the paired `<video>`+`<audio>` route
(route C) for one sitting first. If sync holds, it deletes that issue's entire
media-engine cost.

## Status — 2026-07-27 (transcript auto-fetch)
Transcript now fetches **automatically for new notes**, from both the template
and the Web Clipper. 83 unit tests pass, build clean, installed. **Awaiting
manual test** — the automatic path is event-driven inside Obsidian and is the
one part of this that no test here can exercise.

## What just changed (auto-fetch)
- **Automatic fetch for notes created this session.** No template or clipper
  change was needed: both create a file, and that single condition covers both
  without either side knowing the plugin exists.
- **"Created this session" is the whole gate**, and it is deliberate. Opening an
  old note must never trigger a surprise yt-dlp call and a five-thousand-word
  append. Old notes still have the command.
- **`vault.create` is registered only after `onLayoutReady`.** Obsidian fires
  `create` for every existing file during startup; registering earlier would
  make the entire vault look new and queue a fetch for all of it.
- **Driven off `metadataCache.changed`, not `create`.** A Templater note is
  empty at create time — the frontmatter naming the video does not exist yet.
  `create` and `file-open` also try, which costs nothing: with no video ID yet
  the call returns without recording an attempt, so a later event still fires.
- **Renames are tracked.** Templater renames the note after filling it in, so
  the path recorded at create time is not the path the fetch would see.
- **Fetches are serialized and delayed 1.5s.** Clipping four videos in a row
  must not start four yt-dlp processes, and the delay lets the template finish
  writing rather than racing it for the file. Content is re-read at the last
  moment, so a note that gained a transcript in between is left alone.
- Failures still speak up. Only the "nothing to add" case is silenced on the
  automatic path — a note silently missing a transcript is indistinguishable
  from a video that has no captions.
- Off switch: Settings -> YT Free -> Transcript -> *Fetch automatically for new
  notes*.

## Next step — manual test (automatic path)
1. Relaunch Obsidian.
2. New note from `Templates/8.Watch_Later_Template.md`. Within ~10s expect a
   "fetching transcript..." notice, then `## Most replayed` and `## Transcript`
   appear on their own. Confirm Notes and Description survived.
3. Clip a video with the Web Clipper. Same result, no command run.
4. **Open an old Watch Later note. Nothing should happen.** This is the check
   that matters most.
5. Clip two videos back to back — the second fetch should start after the first
   finishes, not alongside it.

## Status — 2026-07-27 (subscriptions hub scoping)
**Issue 003 (subscriptions hub) is scoped, not built** — see
`docs/V1-SCOPE-SUBSCRIPTIONS.md`. Nothing in `src/` changed. It replaces RSS
Dashboard for the YouTube half only; RSS Dashboard stays for Overcast podcasts.
The load-bearing finding is that the channel feed carries the full description,
so the note path needs no watch-page scrape — but the feed is a rolling
**15-entry** window, which is the constraint the whole design has to respect.

Transcript + most-replayed shipped. 83 unit tests pass, build clean, installed
to the vault. Verified end to end against a real video (Mark Rober,
`h0EGCnBjTVk`): uploaded captions found, 520 cues → 25 sections, 8 replay peaks,
27KB note. **Awaiting manual test.**

## What just changed (transcript command)
- **New command: "Fetch transcript and most-replayed moments".** Answers the
  case that started this — a video whose uploader wrote no chapters, which is
  most of them. Writes two sections into the note.
- **`## Transcript`** — the full transcript, grouped into ~60-second sections
  (configurable 15–180s), each headed by a seek link. The point is not reading
  it top to bottom: search a phrase in the vault, click, and the pinned player
  lands on the second it was said.
- **`## Most replayed`** — YouTube's replay heatmap, top 8 peaks (0–20). A
  greedy minimum-gap pass is what makes this useful: the heatmap is sampled
  every ~15s and one spike covers several buckets, so sorting by value alone
  returns the same moment eight times. Each peak is labelled with the transcript
  line spoken there, because a bare timestamp tells you nothing.
- **One `yt-dlp -J` call** (~3s) yields both the caption-track list and the
  heatmap. The caption URL it returns is already signed and immediately valid,
  so it is fetched directly — no second yt-dlp call, no temp files.
- **Uploader captions beat auto-generated** when both exist. Language keys match
  by prefix: YouTube's multi-language audio produces `en-US-<id>` where you
  expect `en`, which is exactly the shape the test video has.
- **`upsertSection` replaces, never duplicates.** A section runs to the next
  `## `, so re-running the command leaves your Notes and the Description alone.
  An empty body deletes the section rather than leaving a bare heading.
- `allowImportingTsExtensions` is now on: `node --test` runs the TS sources
  directly and resolves imports literally, so `transcript.ts` importing
  `format.ts` needs the extension.

## Next step — manual test
1. Relaunch Obsidian (new `main.js`).
2. Open a Watch Later note, run **YT Free: Fetch transcript and most-replayed
   moments** from the command palette. Expect a notice, then ~3–8s, then two new
   sections at the bottom.
3. Click a transcript timestamp and a replay peak — both should seek the pinned
   player.
4. Run the command a second time: sections should be replaced, not duplicated,
   and your Notes untouched.
5. Search the vault for a phrase from the middle of the video, click through
   from the search result, confirm it lands at the right moment.
6. Settings → YT Free → Transcript: drop section length to 15s, re-run, confirm
   more sections; set most-replayed to 0, re-run, confirm the section is gone.

## Previous status — 2026-07-26
Note-shape pass: properties collapse, in-note player retired, description with
clickable chapters. 58 unit tests pass, build clean, installed to the vault.
**Awaiting manual test (see below).**

## What just changed
- **Properties collapse on video notes.** Opening a note whose frontmatter names
  a video folds the properties table, so the pinned player and the note text are
  what you land on. Obsidian's own collapse toggle is clicked rather than the
  `is-collapsed` class being set, so its internal state and the arrow agree and
  the first click to re-open works. Done once per note per view — expanding by
  hand sticks until you open a different note. Off switch in settings.
- **No more in-note player.** The ```ytfree fence is gone from the Templater
  template and both Web Clipper templates; the pinned player is the only player.
  The fence still works for notes that already have one (it renders the stub).
- **`## Description` with clickable chapters.** Bare `mm:ss` / `h:mm:ss` text in
  a note that names a video renders as a seek link into the pinned player, using
  the same `ytfree:<id>:<secs>` scheme flow capture writes. This lives in the
  plugin, not the templates, because the Web Clipper can copy a description but
  cannot rewrite it — and doing it at render time also fixes notes clipped
  before today.
  - The Templater template additionally writes **real markdown links** into the
    file, because it has the video ID at creation time and a link in the source
    survives the plugin being off.
  - `src/description.ts` holds the matcher: guards keep `1:02:03` from also
    yielding `02:03`, keep decimals like `1.5:30` out, and skip anything already
    inside a markdown link.
- **Templater now scrapes the watch page.** oEmbed carries no description, so
  `shortDescription` and `lengthSeconds` are read out of the page HTML. Failure
  is non-fatal: the note is created with the description section empty.

## Next step
Manual test:
1. Relaunch Obsidian (new `main.js`).
2. New note from `Templates/8.Watch_Later_Template.md`, paste a URL for a video
   that has chapters. Expect: properties collapsed, one player at the top, no
   fence, `## Description` populated with clickable timestamps.
3. Click a chapter timestamp — the pinned player should seek there.
4. Expand properties by hand, scroll, switch tabs and come back — they should
   stay expanded until you open a different note.
5. Re-import `System Templates/Obsidian Clipper - Watch Later (YT Free).json`
   into Web Clipper, clip a video, confirm the same shape.

## Previous status — 2026-07-26
Issue 002 (offline download) built and installed. 51 unit tests pass; the yt-dlp
argument shape was verified against a real 19-second download. **Awaiting the
14-step manual test in `issues/002-local-download.md`.**

A pickup note for the download work also lives in the vault at
`MyVault/YT Free — Offline Download Plan.md`, per BarkernotBob's request.

## What just changed (issue 002)
- **Download button + two commands.** Downloads the note's video to
  `~/Movies/YT Free/`, writes `local_media:` into the frontmatter, and swaps the
  running player onto the file at the same position — the swap is invisible.
- **`media_link` is never replaced.** Timestamps are keyed by video ID parsed out
  of that URL; replacing it with a path would kill every `ytfree:` link in the
  note, lose provenance, and make re-download impossible.
- **Files live outside the vault** (iCloud). That means frontmatter syncs to the
  second Mac and the file does not, so that Mac silently streams. Deliberate.
- **`<title> [<videoId>].mp4`.** If the recorded path is gone, the folder is
  searched for the bracketed ID, so renaming in Finder is harmless.
- **No ffmpeg on this Mac**, so the pre-muxed fallback is the live path today,
  not a corner case. Downloads say so rather than failing.
- Local playback goes through Obsidian's `app://local/` handler; `file://` is
  blocked by the renderer. A bad local file falls back to streaming once.
- `src/download.ts` isolates everything testable without Obsidian.

## Next step
Manual test (issue 002). Relaunch Obsidian first.

## Previous status — 2026-07-26 (later)
Pinned player shipped and installed; ad-hoc playlist URLs now resolve.
All automated tests pass: 41 unit, 5 live. **Awaiting manual test.**

## What just changed
- **Pinned player.** When a note's frontmatter names a YouTube video
  (`media_link`, then `url` — configurable), the full player mounts above the
  note body inside `.view-content` and stays put while the note scrolls. This
  replaces the Media Notes plugin, which owned that spot and has been disabled
  in the vault's `community-plugins.json`.
- Same player as the fenced block — controls, speed, PiP, timestamp, stream
  recovery — because both now go through one `buildPlayer()`.
- A ```ytfree fence whose video is already pinned renders a one-line stub
  instead of a second player, so nothing double-buffers or fights over the
  `players` map key.
- Height is a fixed `vh` from settings, not content-driven: nothing the player
  does can reflow the note text under it.
- `syncPinnedPlayers()` is idempotent and reconciles on layout-change,
  active-leaf-change, file-open and metadata changes; an `isConnected` check
  catches Obsidian rebuilding a view's DOM underneath us.
- **`watch_videos?video_ids=a,b,c` parses.** YouTube's ad-hoc playlist URL names
  no single video, so `extractVideoIds()` returns the whole queue and
  `extractVideoId()` takes the first. Handles `%2C` and plain commas.

## Next step
Manual test in Obsidian (relaunch first — Media Notes only stays off after a
restart): open a Watch Later note, confirm one player at the top, confirm
timestamps still stamp and seek, confirm no double player under the fence.

## Previous status — 2026-07-26
v1 confirmed working in Obsidian. Issue 001 (flow capture) is built and installed;
**two rounds of manual-test feedback applied, awaiting re-test.** All automated tests
pass: 39 unit, 5 live.

## What just changed (third pass)
- **Displayed time and seek target are now different numbers.** `{ts}` shows the moment
  the line was written; `{link}` / `{seconds}` point `lookbackSeconds` earlier. A line
  reading `3:05` seeks to `3:00`. Reading and replaying want different answers.
- **Enter no longer pauses the video.** Pausing moved off `updateListener` (which fires
  for Enter and for programmatic writes) onto the same `inputHandler` as stamping, so only
  real character input pauses.
- **On bulleted lines the stamp waits for the first word.** Typing `-`/`*`/`+` doesn't
  stamp, and neither does whitespace, so the bullet is typed clean and Obsidian renders
  the list; the stamp then arrives with the text: `- [3:05](…) text`. An earlier pass
  skipped bulleted lines entirely — that was wrong, they should stamp.

## What changed in the second pass
- **The trigger moved from Enter to the first character typed on a line.** Enter failed
  twice in real use: the first line of a note never got stamped (you don't press Enter to
  reach it), and Enter writing text raced with the typing that followed. Now
  `EditorView.inputHandler`, and Enter is untouched.
- **Play/pause is no longer part of the stamp decision.** The old gate was "playing OR
  paused-by-us", which still skipped stamps when the user paused by hand. Replaced with a
  single `hasPlayed` guard, which exists only to stop an unplayed note stamping 0:00.
- `stampInsertOffset()` decides where the stamp goes; it fires after indentation, list
  bullets, checkboxes, quotes and headings, so auto-continued list lines still stamp.
- Player gained `hasPlayed`. `isPlaying` / `isPausedByTyping` remain but no longer gate
  stamping.

## What changed in the first pass
- Issue 001 implemented: auto-timestamp, lookback offset, pause-while-typing. All three
  on by default (`lookbackSeconds: 5`, `resumeIdleMs: 2000`).
- New `src/capture.ts` holds the pure decision logic — lookback maths, the stamp gate,
  fence detection — so the part most likely to break is unit-testable without an editor.
- `src/player.ts` gained `pauseForTyping` / `resumeAfterTyping` and a `pausedByTyping`
  flag, plus `isPlaying`.
- `src/main.ts`: players are now `PlayerEntry { player, videoId, sourcePath }` so capture
  can ask "which player is in *this* note" instead of falling back to any player.
- Typing is detected with an `EditorView.updateListener` for the pause behaviour.
- `esbuild.config.mjs` now marks `@codemirror/*` external — verified in the built
  `main.js`.
- New unit suite `tests/capture.test.ts`.

## Exact next step
Reload the plugin in Obsidian, then run the manual test in `issues/001-flow-capture.md`
(sections A–G). Section B is the one that was broken and is worth checking first.

## Key decisions worth remembering
- Notes store **video IDs only**. Never write a resolved URL to disk; they expire and are
  IP-locked. This is the core design constraint.
- **The stamp gate must not test play/pause at all.** Two versions of this were wrong:
  `!video.paused` (dead on arrival, since pause-while-typing pauses first) and then
  "playing OR paused-by-us" (still skipped stamps when the user paused by hand). The
  position is well defined in every state, so the gate doesn't ask. Guarded by a named
  regression test that also asserts no `isPlaying` field exists on the gate input.
- **The trigger is typing, not Enter.** Enter can't stamp the first line of a note, and
  an Enter that writes text races with the typing after it. Enter must also not pause —
  which is why pausing hangs off `inputHandler` and not off `updateListener`.
- **Never stamp on the bullet character or on whitespace.** A stamp before the bullet
  stops Obsidian rendering the list; a stamp on the space strands the text after it. The
  correct trigger on a list line is the first word.
- **`{ts}` and `{link}` intentionally disagree.** The text shows where you were; the link
  lands `lookbackSeconds` earlier. Making them match again would undo the point.
- **`pausedByTyping` is only ever set by a pause we performed**, because `pauseForTyping`
  no-ops on an already-paused video. That is what stops the idle timer resuming a video
  the user paused themselves.
- **CodeMirror must stay external in the esbuild config.** Bundling a second copy means
  our keymap registers against a different module instance and never fires. This failure
  is silent — no error, the key just does nothing.
- Resolution timing is unstable: measured 28s cold, then ~4s warm. yt-dlp appears to
  cache its JS challenge solver. Do not treat a single slow run as a regression — re-run.
- `ios` player client is broken (returns images only). `android_vr` is the fast client
  but exposes 360p only. Both facts drove the two-stage design.

## Open risks
- 5s lookback is a guess, not a measurement. It is a slider for that reason.
- Players are keyed by video ID alone, so the same video open in two notes collapses to
  one entry (last render wins). Flow capture would target the wrong note. Edge case, left
  unfixed deliberately — see the comment on `PlayerEntry`.
- `EditorView.updateListener` fires on any doc change, not strictly on keystrokes. A sync
  or another plugin writing to the note will also pause playback.
- `npm` flagged esbuild's postinstall script as unapproved. Build works, so it was not
  needed, but a clean clone may need `npm approve-scripts`.
