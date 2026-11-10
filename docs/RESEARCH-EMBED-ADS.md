# Why YouTube's player shows no ads in YT Free

Research for the hosted player page (`docs/player/index.html`, served at
`barkernotbob.github.io/obsidian-ytfree/player/`), used on the phone (#25) and as the
last fallback (#43). Written 2026-11-10. Observation that started it: Isaiah saw no ads on
the iPhone (one video, several tries, 2026-11-10).

## Answer

Most likely cause: **our page starts the video itself.** Google's requirements for ads on
embedded videos say videos "should be embedded using the standard click-to-play embed and not
a scripted play" ([Ads on embedded videos](https://support.google.com/youtube/answer/132596)).
The page sets `autoplay: 1` and also starts playback with `player.playVideo()` when the plugin
asks. Neither is a click on YouTube's own play button.

Status: **likely, not confirmed.** Google lists click-to-play as a requirement for ads; it does
not say in so many words that a scripted start never gets ads. The device test below confirms
or rules it out.

## Facts (sourced)

| # | Fact | Source |
|---|------|--------|
| F1 | Ads on embeds require a "standard click-to-play embed and not a scripted play". | [132596](https://support.google.com/youtube/answer/132596) |
| F2 | Ads also require a player "large enough"; 200x200 px or larger recommended. | [132596](https://support.google.com/youtube/answer/132596) |
| F3 | "Ads appear on brand safe sites." | [132596](https://support.google.com/youtube/answer/132596) |
| F4 | Embeds follow the video's own ad settings; there's no switch to turn ads off for embeds only. | [132596](https://support.google.com/youtube/answer/132596) |
| F5 | "Embedded videos that are autoplayed don't increment video views." | [171780](https://support.google.com/youtube/answer/171780) |
| F6 | A play counts as a view only if "initiated via a native play button in the player". | [IFrame API, playVideo](https://developers.google.com/youtube/iframe_api_reference) |
| F7 | Privacy-enhanced mode (no cookies) makes ads **non-personalized**, not absent. | [171780](https://support.google.com/youtube/answer/171780) |
| F8 | Autoplay is allowed: it must start on load or once more than half the player is visible, one autoplaying player per screen. | [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) |
| F9 | Overlays or anything in front of the player are not allowed; nor changes the API docs don't describe. | [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality) |
| F10 | The policy guide lists as a violation: "Restricting ads from playing in your API service when they would otherwise play on YouTube or in an embedded video." | [Developer Policies guide](https://developers.google.com/youtube/terms/developer-policies-guide) |

What our code does (checked in `main` 641e205):

- `docs/player/index.html`: `playerVars: { playsinline: 1, start, rel: 0, autoplay: 1 }`, loads
  `www.youtube.com/iframe_api` (not youtube-nocookie), and calls `playVideo()` on the plugin's
  `play` command. The `gh-pages` copy is identical.
- `src/mobile/youtube-embed.ts`: frames the page full size over the stage with
  `allow="autoplay; …"`. The player is far above 200x200.

## The three earlier guesses, re-rated

1. **Scripted start (autoplay / playVideo): likely the cause.** F1 directly; F5 and F6 show
   YouTube treats scripted plays differently from native-button plays.
2. **github.io site rating: unknown.** F3 says ads need a brand-safe site, but Google doesn't
   publish how github.io is rated. Can't be checked from outside; the device test separates it.
3. **Safari / WebKit cookie blocking: unlikely to be the cause.** Per F7, losing cookies makes ads
   non-personalized, not absent. It could lower ad frequency, not remove ads.

Other things that also give "no ads" and must be ruled out: the video isn't monetized (F4), and
YouTube doesn't show an ad on every play even on youtube.com. One video is weak evidence.

## What could bring ads back, and how we'd notice

| Change | Effect | How to notice |
|--------|--------|---------------|
| The reader taps **YouTube's own play button** (cued start, `play=0` in PR #90, or iOS blocking the unmuted autoplay) | That is the standard click-to-play (F1): ads likely | Device test step 3 below after any change to how the YouTube player starts |
| Someone removes `autoplay: 1` or changes the page to click-to-play | Same | Guard test on `docs/player/index.html` (issue filed) |
| `gh-pages` copy and `docs/player/` drift apart | Live page differs from the reviewed one | Guard test compares them, or one Pages source only |
| Google changes its embed ad rules | Ads may appear on scripted starts | Re-run the device test each release; watch 132596 for edits |
| A video's owner or YouTube changes that video's ad settings | Per-video | Test with 3 different videos, not one |

No API reports ads in the embed, so detection is a device check, not code.

## Policy risk (fact, then opinion)

Fact: F8 allows autoplay. F10 calls restricting ads that would otherwise play a violation.
Opinion: starting the video ourselves is allowed on its own, but keeping it *because* it avoids
ads could be read under F10. The store build is ad-free by Isaiah's decision (2026-11-09) and
the YouTube terms risk is his accepted risk; this note records the specific clause.

## Safeguards

1. Every start of YouTube's player stays scripted: `autoplay: 1`, or `playVideo()` from our page
   (a muted start then `unMute()` is still scripted). Never make the reader tap YouTube's play.
2. A test that fails if `docs/player/index.html` stops autoplaying on the normal path, or if the
   `gh-pages` copy differs.
3. The device test below on every release that touches the YouTube player.

## Device test (iPhone, about 10 plays, not bulk)

Pick a popular music video that shows an ad in the YouTube app. Use the same video for all steps.

1. In Obsidian, open the video, switch to YouTube's player. It starts by itself. Note: ad or no
   ad. Close and repeat 3 times.
2. In **Safari** (not Obsidian), open
   `https://barkernotbob.github.io/obsidian-ytfree/player/?v=<videoId>`. Safari usually blocks
   the sound autoplay, so you'll see YouTube's play button. Tap it. Note: ad or no ad. Repeat 3
   times. (If it starts by itself, say so; that run doesn't count.)
3. In Safari, open `https://www.youtube.com/embed/<videoId>` and tap play. Repeat 3 times.

Reading the results:

- Step 1 no ads, step 2 ads: **confirmed**, the scripted start is why. github.io is not.
- Steps 1 and 2 no ads, step 3 ads: the github.io page (site rating) matters, not autoplay.
- No ads anywhere: the video isn't showing embed ads; pick another video.
