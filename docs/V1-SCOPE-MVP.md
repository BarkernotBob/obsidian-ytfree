# V1 scope: Obsidian store MVP

**Status:** 2026-11-09. Isaiah chose an ad-free store build with our own stream; MVP list below.
**Goal (Isaiah, 2026-11-09):** the minimum to get YT Free listed in Obsidian's community
directory. Everything not on the MVP list waits. New filings get an MVP / post-MVP call here.

## The one decision that shapes everything

**Decided (Isaiah, 2026-11-09):** the store version is ad-free, like his own. Ads were only ever
meant to help get accepted, and Obsidian does not require them. So:

- **One build for everyone.** Our own stream on desktop and phone, with no install needed (the
  InnerTube path the phone and the desktop fallback already use). yt-dlp stays optional on
  desktop for HD, downloads and Smart Speed.
- **YouTube's embedded player as the fallback** when our stream fails for a video (#43).
- The store/local build split (#60) is no longer needed for MVP: nothing differs between the two.

Consequence: playback, HD and bot-check bugs now affect store users, so they are MVP.

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

Inference: the ad-free build would very likely pass Obsidian's automated scan. Whether it breaks
YouTube's Terms is disputed: Isaiah's view (2026-11-09) is that signed-out, user-started playback
is neither a Terms breach nor automated access. My reading is that the Terms apply signed out too
and that the hub's hourly polling is automated; user-started playback is the stronger case. Isaiah
accepts the risk. A store listing makes the plugin public and easier to flag. Its metadata features (hub, search, channel screen,
transcripts) still read YouTube's unofficial endpoints. That is a grey area that many listed
plugins share. I can't tell how likely YouTube or Obsidian is to act on it.

## What a video loses when it falls back to YouTube's player (#43)

Checked against the code: the hosted page reports time, duration, state, speed and quality to the
plugin and accepts `seek` and `rate` commands (`docs/player/index.html`,
`src/youtube-player.ts`). Today it is only a phone pop-up that reads the time back when closed
(`src/mobile/youtube-player-modal.ts`), so "keeps" below mostly means "needs wiring inline", not
"works now".

| Feature | On the YouTube player fallback, desktop and phone | Notes |
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
| Offline downloads | Unaffected | A downloaded copy plays in our player. |
| Transcript, most-replayed | Keeps (phone path) | Not player-dependent; unofficial endpoint. |
| Subscriptions hub, RSS polling, backfill, channel screen, search | Keeps | Not player-dependent. |
| Halfway thumbnails, paste/click link to Preview, hub deep link, share | Keeps | Not player-dependent. |
| Videos our stream can't play | Play | The reason for the fallback. |

## MVP list

| # | Item | Why MVP | Issue |
|---|---|---|---|
| M1 | Fallback to YouTube's embedded player when our stream fails, wired for resume, progress, timestamps, speed | Isaiah's fallback; some videos refuse our stream | #43 |
| M2 | GitHub Pages serving the hosted player page (one-time repo setting; users do nothing). Needed on the phone: a direct embed from `capacitor://localhost` gets error 153. Desktop: try a direct embed first | M1 depends on it on the phone | Isaiah, one command |
| M3 | Store compliance: LICENSE, `versions.json`, `x.y.z` tags (`v0.1.0` fails), manifest description ≤250 chars, `isDesktopOnly: false`, README disclosures (network use: YouTube, GitHub Pages; optional yt-dlp; optional sign-in and the cookie file outside the vault), fix Obsidian lint errors (32 today) | Automated scan fails otherwise | #61 |
| M4 | Device test of every merged-but-untested feature: HD before Play, quality switch, keep playing / background pause, phone HD (native HLS), hub Saved / In progress, phone ⋯ menu, phone properties, paste-to-Preview, hub deep link, request budget parts 2–3 | "Fix known bugs" | #62 |
| M5 | Search: filters, drop "Related to your search", review all search logic | Isaiah, 2026-11-09 | #46 |
| M6 | Local watch history with stats | Isaiah, 2026-11-09 | #48 |
| M7 | Phone HD stops after about a minute | Bug in a shipped feature | #25 |
| M8 | Desktop "quality" resolve returns no HLS manifest: check it still happens after #32, close if not | Bug in a shipped feature | #5 |
| M9 | Unfiled bugs Isaiah knows of | "Fix known bugs" | Isaiah to list |

## Post-MVP

| Issue | Why not MVP |
|---|---|
| #60 Store/local build split | Not needed while both builds are the same |
| #15 HD quality picker / ABR | New feature; HD and the per-video switch already ship |
| #26 Music / lock-screen | New feature |
| 018 Watch Later | Parked by Isaiah |

Rule for new filings: MVP if it is a bug in a feature the plugin ships, something the store
submission or scan requires, or Isaiah names it MVP. Everything else is post-MVP.

## Manual test

Written when M1 lands; M4 is the device test of everything else.
