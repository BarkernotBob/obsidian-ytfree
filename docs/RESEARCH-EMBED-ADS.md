# Why YouTube's player shows no ads in YT Free

Research for the hosted player page (`docs/player/index.html`, served at
`barkernotbob.github.io/obsidian-ytfree/player/`), used on the phone (#25) and as the last
fallback (#43). 2026-11-10, with device tests by Isaiah.

## Answer

**No ads because the page runs inside Obsidian's iOS app, not because of anything in our code.**
Same hosted page, same video (`dQw4w9WgXcQ`), the reader taps YouTube's play button each time:

| Where | Runs | Ads |
|-------|------|-----|
| Arc (Mac), page opened directly | 3 | yes (ad blocker off) |
| Arc (Mac), page framed by a local file, the way Obsidian frames it | 3 | yes |
| Safari (iPhone), page opened directly | 4 | 1 |
| Obsidian (iPhone), YouTube's player, incl. scrubbing, Preview and in a note | 10+ | 0 |

Ruled out:

- **github.io site rating**: ads showed in Arc and in iPhone Safari on the same page.
- **Autoplay / scripted start**: Isaiah taps play in Obsidian too; in Arc autoplay was refused
  and a tap brought an ad. (An earlier draft of this doc blamed autoplay; that was wrong.)
- **Framing by a page that isn't a website**: a `file://` wrapper in Arc still got ads.
- **A system-wide blocker**: none on the Mac (Arc showed ads), none reported on the iPhone.

Strength: at Safari's 1-in-4 rate, 0 in 10 happens by chance about 6% of the time, and the
Obsidian log agrees (below). Strong evidence, not proof.

Which part of the iOS app (guess, unverified): Obsidian shows pages in WKWebView, whose user
agent lacks Safari's `Version/… Safari/…` tokens. Google may treat it as an in-app web view and
not serve the embed ad. No Google source found that says so.

**Durability: nothing in our code causes it, so we can't lock it in.** Google can change it at
any time, for all users at once. What we can do is detect it. Desktop Obsidian (Electron) is
untested.

## Detecting an ad from the log

The hosted page reports YouTube's player state to the plugin, and the plugin writes page events
to `youtube-player-log.txt` in its folder (syncs off the phone).

During a pre-roll ad the IFrame API reports state `-1` (unstarted) while `getCurrentTime()`
advances (the ad's clock). After the ad the video goes `3` (buffering) then `1` (playing) at
0:00. The Arc run with an ad: `-1` from 1.0 s to 8.1 s with the clock running 0.0 to 5.9 s.
YouTube pre-rolls are at least about 5–6 s (inference from ad formats, not measured here).

Obsidian iPhone log, 13 opens (2026-11-10, 13:16–13:27 local): every `-1` lasted 0.9–3.8 s
before `3` or `1`, the reader's tap included. Shorter than any pre-roll, so no ad played.

## Google's documented rules (sourced)

| # | Fact | Source |
|---|------|--------|
| F1 | Ads on embeds: "videos should be embedded using the standard click-to-play embed and not a scripted play." | [132596](https://support.google.com/youtube/answer/132596) |
| F2 | Player must be "large enough"; 200x200 px or larger recommended. | [132596](https://support.google.com/youtube/answer/132596) |
| F3 | "Ads appear on brand safe sites." | [132596](https://support.google.com/youtube/answer/132596) |
| F4 | Embeds follow the video's own ad settings; no switch to turn ads off for embeds only. | [132596](https://support.google.com/youtube/answer/132596) |
| F5 | "Embedded videos that are autoplayed don't increment video views." | [171780](https://support.google.com/youtube/answer/171780) |
| F6 | Privacy-enhanced mode (no cookies) makes ads non-personalized, not absent. | [171780](https://support.google.com/youtube/answer/171780) |
| F7 | Embeds need an HTTP Referer; without one, Error 153. | [171780](https://support.google.com/youtube/answer/171780) |
| F8 | No overlays or anything in front of the player. | [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) |
| F9 | Listed as a violation: "Restricting ads from playing in your API service when they would otherwise play on YouTube or in an embedded video." | [Developer Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide) |

None of these mentions in-app web views, so the cause above is not documented by Google.

## Policy note

We don't block, hide or restrict ads: the page is YouTube's standard IFrame player with
standard parameters, and whether to serve an ad is YouTube's decision (F9 is about clients
that restrict ads). Keep it that way: no overlays (F8), no ad-skipping code. The YouTube terms
risk of the store build is Isaiah's accepted risk (2026-11-09).

## Safeguards

1. Don't add anything that interferes with ads; if Google starts serving them in Obsidian, they
   play. That keeps us on the right side of F9.
2. Detect the change: the page logs a line when YouTube reports `-1` while the clock advances
   (an ad), so a user's log or a device test shows it at once (issue #91).
3. Re-run the device test below on releases that touch the YouTube player, and once on desktop
   Obsidian when the desktop YouTube player is built.

## Device test

Turn browser ad blockers off. Use `dQw4w9WgXcQ` for every step.

1. iPhone Safari: open
   https://barkernotbob.github.io/obsidian-ytfree/player/?v=dQw4w9WgXcQ and tap play. 4 times.
   Expected: at least one ad (baseline that YouTube is serving embed ads).
2. Obsidian (iPhone): open the video, switch to YouTube's player, tap play, let it run 15 s.
   10 times. Expected: no ads; `youtube-player-log.txt` shows every `-1` under 5 s.
3. If step 1 has no ads, YouTube isn't serving embed ads right now: the test says nothing; retry
   another day.

Don't open `youtube.com/embed/<id>` directly: no referrer, Error 153 (F7).
