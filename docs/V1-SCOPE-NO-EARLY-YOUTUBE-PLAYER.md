# V1 scope: no early switch to YouTube's player (#121)

**Written:** 2026-11-25, from Isaiah's report: "Some videos really quickly are auto going to the yt
player, even though when I switch back to our player it works fine." Store MVP (a bug in #43,
against the rule "YouTube's player only on a real failure, never preemptively").

## Cause (read from main 2f69005, not measured on a device)

Our own stream is the phone's only tier and the desktop's last. Two things failed it on the first
hiccup, so the next step was YouTube's player with no fresh link ever tried:

1. **One dead link.** `cachedProvider` marked the tier failed *before* re-resolving. A link dies
   for ordinary reasons: the kept player answer (kept for hours, across reloads) was fetched on
   another network, and googlevideo links are IP-locked (Wi-Fi vs cellular).
2. **One network blip** while resolving (timeout, 5xx) marked the tier too.

"Try our stream again" clears the marks and asks fresh, which is why switching back works.

## Fix

1. Our own stream's first dead link asks for one fresh link on the same tier. The second dead link
   within 30 minutes fails it, then YouTube's player (as before).
2. yt-dlp's dead link still moves on at once to our own stream (#43 part 1: asking yt-dlp again
   gets the same refusal).
3. A network blip resolving our own stream is asked once more after 1 s. Not retried: an answer
   from YouTube (unplayable, members-only, no format), an HTTP 4xx (refusal or rate limit), a bot
   check, an age gate.
4. A media error of type "aborted" (the fetch stopped on our side) re-resolves and never counts
   as a dead link.
5. Cost: at most one extra player request per video, only when a link dies or a request fails.

## Manual test (phone)

1. Open a video note on Wi-Fi, press Play, let it play 10 s, pause.
2. Turn Wi-Fi off (cellular on), go back to the hub, open a different video that was in your feed
   before you switched, press Play.
   Expected: it plays in our player. You may see "Refreshing stream (playback error)…" for a moment.
   It does not switch to YouTube's player.
3. Play three or four other videos as usual. Expected: all in our player.
4. If any video still switches to YouTube's player: Settings → YouTube for You → turn on debug
   logs, repeat, and send the lines starting "YouTube for You".
