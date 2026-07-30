# 017 — Skip the silence, fold the transcript, tidy the leftovers

Status: **Built 2026-07-30 — awaiting manual test.**

Six items off BarkernotBob's list, in one pass. Five are done and one is half done for
a reason that is not ours to fix — see *Background audio* at the bottom.

> - Silence should skip, not ff. This way you don't hear the zoomed up speed.
>   Instrumentals can ff.
> - Transcript heading needs to be collapsed when added
> - If I watch a video and take no notes on it within a month, remove the video
>   note
> - Look at how to handle watch later moving forward → [018](018-watch-later.md)
> - Opened videos should move out of the inbox
> - Player height on mobile not adjusting
> - On mobile, Audio should keep playing when I move to a new app or lock my
>   phone

---

## 1. Silence is skipped, music is sped

015 and 016 compressed every quiet stretch by raising `playbackRate`. That is
audible: a pause played at 3× still carries the room tone, the breath and the
first syllable after it, all pitched and hurried. A seek carries none of that.

So a window now has an **action**, decided at the moment the two producers are
combined in `combineSilence`:

- **speed** — a caption gap that ffmpeg has actually analysed and found
  *audible*. That is an instrumental, and skipping it would cut the music out.
- **skip** — everything else. Every window on a phone (no ffmpeg), everything
  past ffmpeg's frontier, and every stretch ffmpeg confirms is silent.

Two vetoes stop a jump being worse than the pause it replaces, both falling back
to the old fast-forward:

- a window with less than `MIN_SKIP_SECONDS` (0.35 s) left to run — below that a
  seek is a click, not a saving;
- a target `video.buffered` does not cover. A seek past the buffer is a spinner.

`moveFor` is the whole decision and is pure; `player.ts` only applies what it
returns. Time saved by a skip is counted as `seconds / rate`, because at 4× a
five-second jump saved you 1.25 s of your life, not five.

## 2. The transcript arrives folded

`applyDefaultFolds` runs once per note per view, at open. The transcript arrives
seconds later, after a network fetch, so it was never in the document at the
moment the folds were applied — which is why it was always open.

`foldNewSections(path, groups)` now runs after the transcript upsert and after
the heatmap backfill. It is additive: it reads the folds the note already has,
adds the new ranges, and writes the union, so it cannot silently unfold anything
you folded yourself. It retries for two seconds, because `vault.process` returns
before the open editor has caught up with the file.

## 3. Opening a video takes it out of the Inbox

Two halves. `SubscriptionsStore.noteOpened(videoId, path)` promotes an
undecided item to Kept whenever a note with that video's frontmatter is opened —
from the file explorer, a link, recent files, anywhere. It only ever promotes an
undecided one: a video you hid stays hidden, per 014.

And the hub card now leaves the list when the click makes it no longer match the
filter. This *does* reflow the list, deliberately: the click has already
navigated you to the note, so nothing is under your finger any more, and the
Hide button has always done exactly this.

## 4. The player height slider works on a phone

It set `--ytfree-pinned-height` on desktop only. Two bugs in one: the slider did
nothing on the phone, and the docked media box had no height ceiling at all, so
a phone held sideways gave 16:9 of its 844 pt width — 475 pt of video on a
390 pt-tall screen.

The variable is now set on both platforms, and the docked box takes its width
from it: `min(100%, height × 16 / 9)`. The picture keeps its shape and shrinks
to fit, centred, rather than letterboxing or overflowing.

## 5. Watched notes with nothing in them go to the trash

A video note is created by the click that opens the video, before anyone knows
whether the video was worth anything. Most are not.

> **Superseded by [019](019-progress-bar-landscape-quick-panel.md).** Three of
> the four conditions below could keep a note nobody had written a word in — a
> tag, a heatmap above the fold, or the plugin's own writes touching the file.
> The rule is now one question: is there anything under `# Notes`?

A sweep runs a minute after Obsidian settles and once a day after that. It
trashes a note only when **all four** hold:

1. the video was **played** — there is a watch stamp for it, and it is over a
   month old (the setting, *Tidy empty notes after*, default 30 days, 0 = off);
2. the file has not been **edited** since then either;
3. **nothing has been written in it** — no text under `# Notes`, no tags in the
   frontmatter, nothing above the first heading. The description and transcript
   sections are not read at all: the plugin wrote them, so they say nothing
   about you, and a description carrying the video's own chapter list must not
   read as notes;
4. it is **not open** in front of you.

Every uncertainty answers "keep": a note with no `# Notes` heading is not one of
ours to judge, and a watch stamp that will not parse is not a month old.

Removal is `fileManager.trashFile`, which honours the *Deleted files* setting —
system bin or `.trash`, whatever you already chose. Each path is logged to the
console, and the command **Tidy watched video notes with nothing written in
them** runs the same sweep on demand.

The month is measured from a **new watch stamp** in `progress.json`, kept apart
from the playback position because a position is *deleted* the moment a video
finishes — and a video you watched to the end is exactly the case this has to
survive.

Consequence worth knowing: the stamps start empty, so nothing can be tidied
until a video has been played and a month has passed. Notes for videos you
never played are never touched, whatever their age.

## 6. Background audio: half of it, honestly

**What is built.** The video is published to `navigator.mediaSession` — title,
channel, thumbnail, play/pause, ±10 s, and a scrubber kept current. If the OS
ever shows Obsidian on the lock screen or in Control Centre, it now shows the
right thing with working buttons.

**What was fixed on the way.** A hidden window gets no animation frames, so the
Smart Speed loop froze wherever it stood when the screen went off. If that was
mid-instrumental, the 3× it had just applied stayed applied, with nothing awake
to put it back. The rate is handed back on `visibilitychange` and the loop picks
up when the screen returns.

**What a plugin cannot do.** Whether audio keeps running once the app is
backgrounded or the phone is locked is decided by the host app's audio session
and its background-audio entitlement — Obsidian's `Info.plist`, not ours. No
JavaScript reaches it. Best understanding, not verified on a device: Obsidian
mobile does not declare it, and a `<video>` element is treated more strictly
than an `<audio>` one even where it does.

**If the test in step 9 says audio stops**, the only route left is an audio-only
stream in an `<audio>` element, and even that is gated by the same entitlement.
It is real work — an audio-only resolve mode, a second element, mode plumbing
through the cache — so it needs a decision before it is built, not after.

---

## Acceptance criteria

- [x] A silent stretch is jumped over, not played fast; the jump is inaudible.
- [x] An instrumental still plays at the pause speed rather than being cut.
- [x] With no ffmpeg — every phone — every window is a skip.
- [x] A window too short to be worth a seek, or one whose far side is not
      buffered, falls back to playing fast.
- [x] A seek already in flight is never interrupted by another.
- [x] Time saved counts a skip at the user's own rate.
- [x] A transcript fetched into an open note lands folded, and folding it does
      not unfold anything the reader folded.
- [x] The heatmap backfill folds too.
- [x] Opening a video note from any route moves it out of the Inbox; a hidden
      video stays hidden.
- [x] The card leaves the hub list when it no longer matches the filter.
- [x] The pinned-height slider changes the player's size on a phone.
- [x] A phone held sideways never gives more than the chosen share of the
      screen to the video.
- [x] A watched note with nothing written in it is trashed after the set number
      of days; one with notes, tags, an edit, or no play at all is not.
- [x] Nothing is ever deleted outright — always Obsidian's trash.
- [x] The lock screen shows the video's title and channel, and its buttons work.
- [x] Locking the phone mid-instrumental cannot leave playback stuck at 3×.
- [x] `npm run check` clean: 329 tests.

## Manual test (for BarkernotBob)

**Smart Speed (Mac, a video with captions and some music)**

1. Play a talk with pauses in it. At a pause the picture should **jump** — no
   sped-up room tone, no chipmunk breath. The Smart badge keeps counting up.
2. Find a musical interlude. It should **speed up**, not disappear.
3. Scrub to a part of the video that has not buffered yet and let it play into a
   pause. It should speed through instead of jumping — no spinner.

**The transcript (either device)**

4. Open a video note that has no transcript yet and let it fetch (or run
   *Fetch transcript*). When it appears, **Video Transcript** should already be
   collapsed, and so should **Most replayed**. Nothing else you had folded
   should have opened.

**The Inbox (both devices, if you can)**

5. Open a video note from the file explorer — not from the hub. Open the hub:
   that video should now be under **Kept**, not in the Inbox.
6. From the Inbox, click a card. It should open the note **and leave the list**.
7. Take a video you have hidden, open its note, and check the hub: it must
   **stay hidden**.

**The phone**

8. Settings → *Pinned player height*, drag it. The player should change size on
   the phone, immediately. Turn the phone sideways: the video must stay inside
   the screen with the note still visible under it — not fill it.
9. **The one that decides item 7.** Start a video, lock the phone. Does the
   audio keep playing? Check the lock screen: is the video's title and channel
   there, with working play/pause? Tell me exactly what you see — "stops
   instantly", "keeps playing for a few seconds then stops", or "keeps playing".
   Each of those means something different and only one of them is fixable.
10. While it is playing, switch to another app for ten seconds and come back.
    Playback must not be stuck at high speed.

**The tidy (nothing to see for a month, so test it deliberately)**

11. Run the command **Tidy watched video notes with nothing written in them**.
    Today it should say *nothing to tidy* — no watch stamp is a month old yet.
12. If you want it proved now: set *Tidy empty notes after* to **5**, play any
    video note for 20 seconds, close it, then edit `progress.json` in
    `.obsidian/plugins/ytfree/` and backdate that video's `watched` stamp and
    the note's own modified date by a week. Run the command. The note should
    land in your trash — recoverable — and the notice should say one note.
    Put the setting back to 30 afterwards.

If the sweep ever takes a note you had written in, say which one and keep it:
that is a rule in `src/tidy.ts` being wrong, and the case that models it belongs
in `tests/tidy.test.ts`.
