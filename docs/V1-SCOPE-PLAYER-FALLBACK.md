# V1 scope: playback never dead-ends (#43)

**Written:** 2026-11-10, from Isaiah's report that day: a 2-hour-old video (Nateland, "Surviving
The Oregon Trail") on desktop stopped at "Playback failed repeatedly … try `brew upgrade
yt-dlp`", stuck on "360p · finding HD…". His words: "With the double fallback we built, I thought
this should never happen. I also expect that a user should never have to update yt-dlp
themselves."

**Status:** Approved by Isaiah 2026-11-10 ("Go, as scoped"). Parts 1 and 2 built on PR #79,
which includes PR #83 (the in-place YouTube player it reuses). Part of the store
MVP ([V1-SCOPE-MVP](V1-SCOPE-MVP.md)); the rule is item 7 of [V1-SCOPE-BOT-SAFE](V1-SCOPE-BOT-SAFE.md).

## What went wrong (checked on main d39f7a5, the vault build)

1. **Our own stream only ran when yt-dlp threw.** yt-dlp answered with a 360p link, the link would
   not play, and every retry (`recover()` in `player.ts`) asked yt-dlp again. Three failures in a
   minute, then the brew message. Our own stream was never tried.
2. **YouTube's player (#43) was not built.** `choosePlayer` existed and was tested, but nothing
   called it. The only way into YouTube's player is the phone's ⋯ → Quality menu.
3. **Why the link died: not measured.** Likely YouTube refusing yt-dlp's link (an old yt-dlp, or a
   fresh upload). No probe was run from Isaiah's network to find out.

## Part 1: a dead link moves to the next tier (built)

1. A stream tier fails for a video when it cannot resolve a link, **or when the 360p link it gave
   will not play before it expires**. A link that expired (hours in) is re-resolved on the same tier.
2. The next try uses the next tier (`choosePlayer`): yt-dlp → our own stream. Each tier once.
   After yt-dlp fails for a video, its HD also comes from our own stream.
3. HD dropping back to 360p is not a 360p failure and does not skip yt-dlp.
4. A failure is remembered per video for 30 minutes, then yt-dlp is tried first again.
5. A bot check still stops at once: asking the next tier is more of what flagged the network.
6. Both tiers failed: "YouTube won't stream this video here right now. Try again later, or open
   it on YouTube." with the existing Open in YouTube link. Part 2 replaces this with YouTube's player.
7. **No message tells anyone to install or update yt-dlp.** The brew text is gone from the player
   and the error box.

## Part 2: YouTube's player as the last tier (#43, built)

8. When both stream tiers have failed for a video (or between bot-check retries, as already
   scoped), the player swaps to YouTube's own player in the same place, at the same time and speed.
   Never preemptively. Ads may show there (accepted, store MVP).
9. Kept in that mode: resume position, watch history and time, timestamps into notes and seeking
   from note links (through the player's time/state messages). Not kept: HD ladder, Smart Speed,
   downloads, background play on the phone.
10. A small "YouTube player" label with **Try our stream again**.
11. Phone: the hosted page (`docs/player`) that phone HD already uses. **Needs GitHub Pages on**
    (serving `/docs` from main). Desktop: try framing the embed directly first; if YouTube refuses
    it there (error 153, as on the phone), use the hosted page too. Finding out costs one normal
    Play on Isaiah's Mac, not a probe.

## Part 3: users never update yt-dlp

12. MVP: Parts 1 and 2 make an old or broken yt-dlp harmless: playback moves on without a word.
13. Post-MVP (backlog issue): the plugin keeps its own yt-dlp current. Not built until Obsidian's
    store rules are checked (could not confirm whether a plugin may download and run a binary).

## Manual test

Desktop:
1. Open the note for the video that failed (Surviving The Oregon Trail) and press Play.
2. Expected: it plays. If yt-dlp's link dies you may briefly see "Refreshing stream (playback
   error)…", then it plays from our own stream. You never see a brew message.
3. Open any other video and press Play. Expected: plays as before (yt-dlp first, HD as usual).

YouTube's player can't be forced from the app (never preemptive). It shows only when both streams
fail. If it appears: the picture is YouTube's, the bar shows **Try our stream again**, a
timestamp link in the note seeks it, and the hub's In progress shows where you stopped.

Phone: unchanged unless our stream fails; then the same as above. Needs GitHub Pages on.

## Decided while building (Claude's calls, open to change)

- A bot check answered on this Play also goes to YouTube's player (not only the pause after it),
  per the MVP scope's "after a bot check, straight to the embed".
- The desktop uses the same hosted page as the phone. Framing YouTube's embed directly from
  Obsidian desktop was not tried: it would need a test Play from Isaiah's Mac, and the hosted page
  already works. So the desktop also needs GitHub Pages on.
- The Quality row's "YouTube player (HD)" stays phone-only. On the desktop YouTube's player is
  only ever the fallback, never a menu choice.
- In YouTube's player, watch time counts only while YouTube reports playing, and progress is
  saved every 5 s, on play/pause changes, and on close.
- "Try our stream again" forgets this video's failures and resolves from yt-dlp again.

- The failure memory is 30 minutes, in memory only (a restart forgets it).
- yt-dlp being absent is not counted as a video's failure; the "not installed" path is unchanged.
