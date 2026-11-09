# V1 scope: Obsidian store MVP

**Status:** draft 2026-11-09, awaiting Isaiah's confirmation of the cut.
**Goal (Isaiah, 2026-11-09):** the minimum to get YT Free listed in Obsidian's community
directory. Everything not on the MVP list waits. New filings get an MVP / post-MVP call here.

## The one decision that shapes everything

Isaiah wants the store build to show YouTube's ads and his own build to stay ad-free. The only
way to show YouTube's ads is YouTube's own player (ads are served by the player; there is no way
to put them into a stream we resolve ourselves). So:

- **Store build:** plays through YouTube's IFrame player, framed from the hosted page
  (`docs/player/index.html` on GitHub Pages, already built for #28). No yt-dlp, no InnerTube
  streams, no Node/Electron code, no sign-in. Desktop and phone use the same path.
- **Local build (Isaiah):** today's direct-stream player, HD, yt-dlp, downloads, Smart Speed,
  sign-in. Unchanged.

Side effect: every open playback/HD/bot-check bug only exists in the local build, so none of them
blocks the store.

## Would Obsidian accept it? Would YouTube?

Facts (checked 2026-11-09):

- Submission is now at community.obsidian.md. Every release is scanned automatically
  (policies, code quality, known vulnerabilities, malware); a failing release is not listed or
  installable. Staff review manually only popular, featured or community-flagged plugins.
  Source: [obsidian.md/blog/future-of-plugins](https://obsidian.md/blog/future-of-plugins/),
  [submit page](https://docs.obsidian.md/plugins/releasing/submit-plugin).
- Obsidian's developer policies ban dynamic ads *inserted by the plugin*, client-side telemetry
  and obfuscated code, and require README disclosures (network use, files outside the vault,
  accounts, payments). They say nothing about third-party terms of service or ad blocking. (The
  live policy page would not load; this is from an older mirror of it, so it may be out of date.)
- The directory already lists yt-dlp plugins, including `youtube-native` ("Play YouTube links
  in notes with a native player … Uses yt-dlp") and several downloaders, all marked "not
  manually reviewed". So Obsidian's scan does not block direct-stream or yt-dlp plugins.
- YouTube's Terms forbid downloading content, accessing the service "using any automated means",
  and circumventing any part of the service. They allow showing videos "through the embeddable
  YouTube player". YouTube's API developer policies (which bind anything using the IFrame
  player) forbid blocking or modifying YouTube's ads and modifying or blocking the player's
  functionality.

Inference: the ad-free build would very likely pass Obsidian's automated scan, but it breaks
YouTube's Terms, and a store listing makes it public and easy to flag. The YouTube-player store
build is within YouTube's Terms for playback. Its metadata features (hub, search, channel screen,
transcripts) still read YouTube's unofficial endpoints. That is a grey area that many listed
plugins share. I can't tell how likely YouTube or Obsidian is to act on it.

Opinion: "YouTube's ads" in a plugin's own UI may draw a question about the dynamic-ads rule,
but they come from YouTube's player the user chose to play, as with every embed plugin listed.
Low risk.

## What the store build keeps and loses (YouTube player vs today's player)

Checked against the code: the hosted page reports time, duration, state, speed and quality to the
plugin and accepts `seek` and `rate` commands (`docs/player/index.html`,
`src/youtube-player.ts`). Today it is only a phone pop-up that reads the time back when closed
(`src/mobile/youtube-player-modal.ts`), so "keeps" below mostly means "needs wiring inline", not
"works now".

| Feature | Store build (YouTube player), desktop and phone | Notes |
|---|---|---|
| Video notes, properties, tags, description, sections | Keeps | Not player-dependent. |
| Saved timestamp / resume where you left off | Keeps, needs wiring | Status messages carry the time; save it while playing, not only on close. |
| In progress, watched, Tidy watched notes | Keeps, needs wiring | Same time feed. |
| Insert timestamp at cursor, click a timestamp to jump | Keeps, needs wiring | `seek` command exists. |
| Playback speed | Keeps up to 2× | YouTube's player allows 0.25–2×. |
| **Smart Speed** (skip silence) | **Lost** | Needs the audio; a cross-origin YouTube frame doesn't expose it. |
| HD | Better on the phone, same on desktop | YouTube picks quality; our HD badge, buffered band, Start in HD and quality switch go away. |
| **Keep playing in background / lock screen** | **Likely lost on the phone** (untested) | YouTube reserves background play for Premium; iOS usually pauses a framed player. |
| Pinned/docked player, collapse, Go to the playing video | Keeps, needs rework | Moving a frame in the page reloads it, so docking must not re-parent it. |
| Our controls and ⋯ menu over the picture | Moves below the picture | YouTube's policies forbid overlaying or changing its player. YouTube's own controls show. |
| Fullscreen | YouTube's own button | Our fullscreen handling goes away. |
| **Offline downloads** | **Lost** | yt-dlp; also against YouTube's Terms. |
| **Sign in, account sync (Watch Later, history)** | **Lost** (by choice) | Reads YouTube cookies; too much to disclose and defend in a store plugin. |
| Transcript, most-replayed | Keeps (phone path) | Not player-dependent; unofficial endpoint. |
| Subscriptions hub, RSS polling, backfill, channel screen, search | Keeps | Not player-dependent. |
| Halfway thumbnails, paste/click link to Preview, hub deep link, share | Keeps | Not player-dependent. |
| Bot checks | Mostly gone for playback | YouTube's player is YouTube playing its own video. |

## Build split (item 3)

One codebase, two outputs, chosen at build time:

- `esbuild` `define: { __STORE__: "true" | "false" }`. `npm run build` = local (as today);
  `npm run build:store` = store. Store-only code paths sit behind `if (__STORE__)`, local-only
  ones behind `if (!__STORE__)`; esbuild removes the dead branch, so the yt-dlp, InnerTube-stream,
  sign-in and download code is not in the store `main.js` at all.
- A build check (like today's `assertNoEagerNodeRequires`) fails the store build if its bundle
  contains `child_process`, `yt-dlp`, `googlevideo` or `@electron/remote`.
- **Different plugin ids.** Store: `ytfree` (manifest.json at HEAD, which the directory reads).
  Local: `ytfree-local`, name "YT Free (local)", written by `install.sh`. Otherwise installing or
  updating from the store overwrites Isaiah's build. Note: a new id means a new plugin folder, so
  the local build's `data.json` must be copied once.
- **Releases carry the store build only.** Tags become `x.y.z` with no `v` (Obsidian requires
  the tag to equal the manifest version; `v0.1.0` fails). `setup.sh` then installs the store
  build, so Isaiah installs via `install.sh` only.
- Every PR states which build it affects: both, store, or local. Tests run against both.

## MVP list

| # | Item | Why MVP | Issue |
|---|---|---|---|
| M1 | Build flag, two ids, store bundle check | Item 3 | #60 |
| M2 | Store playback: YouTube player inline on desktop and phone, wired for resume, progress, timestamps, speed; docking without re-parenting | Store build can't play without it | #43 (reframed) |
| M3 | GitHub Pages serving the hosted player page (one-time repo setting; store users do nothing, the plugin loads the page itself). Needed on the phone: a direct embed from `capacitor://localhost` gets error 153. Desktop: test a direct embed in #43 and skip the page there if it plays | M2 depends on it | Isaiah, one command |
| M4 | Store compliance: LICENSE, `versions.json`, `x.y.z` tags, store manifest (description ≤250 chars without "ad-free", `isDesktopOnly: false`), README disclosures (network: YouTube, GitHub Pages), fix Obsidian lint errors (32 today: console logging, 2 regex lookbehinds that break iOS < 16.4, type-safety) | Automated scan fails otherwise | #61 |
| M5 | Device regression pass of shipped-but-untested features that stay in the store build: hub Saved / In progress (#49, #50), phone ⋯ menu (#52), phone properties stay collapsed (#51, cause unconfirmed), paste-to-Preview, hub deep link | "Fix known bugs" | #62 |
| M6 | Search: fix Uploaded / Sort by filters, drop "Related to your search", review all search logic | Isaiah, 2026-11-09 | #46 |
| M9 | Local watch history with stats (videos watched, total watch time) | Isaiah, 2026-11-09 | #48 |
| M7 | Unfiled bugs Isaiah knows of | "Fix known bugs" | Isaiah to list |
| M8 | Store name check | "YT Free" promises ad-free; the store build shows ads | decision |

## Post-MVP

| Issue | Why not MVP |
|---|---|
| #5 Desktop quality resolve, no HLS | Local build only |
| #15 HD quality picker / ABR | Local build only; YouTube picks quality in the store build |
| #25 Phone HD stops after a minute | Local build only |
| #26 Music / lock-screen | New feature; likely impossible with YouTube's player |
| 018 Watch Later | Parked by Isaiah |

Rule for new filings: MVP only if it is a bug in a feature the store build ships, or something
the store submission or scan requires. Everything else is post-MVP, including local-only bugs.

## Manual test (store build)

Written when M1–M2 land.
