# 001 — Flow capture: auto-timestamp new lines, pause while typing

**Status:** Built 2026-07-26. Automated tests pass. Awaiting the manual test below.

**Created:** 2026-07-26

## Problem

v1 gives two ways to capture a timestamp: the `insert-timestamp` command (hotkey) and the
Timestamp button on the player. Both are *invocations* — you stop taking notes, do a
second thing, then resume. Both also stamp the moment you invoked them, which is already
several seconds after the moment you actually cared about.

The goal is that the note-taking action **is** the capture action. No command, no hotkey,
no aiming the cursor.

## Solution

Three behaviours, all on by default.

### 1. Auto-stamp on new line

The **first character you type on a line** brings the timestamp in with it. You just type.

Revised 2026-07-26 after testing. The trigger was originally Enter, which was wrong twice:

- The **first line of a note never got stamped** — you don't press Enter to reach it.
- **Enter both broke the line and wrote text**, which raced with the typing that followed.

Typing is the correct trigger because it is the same moment in every case: the instant you
start writing a thought. There is now exactly one trigger and no interaction with Enter,
which is left completely alone.

- Fires after indentation, block quotes, heading markers, list bullets and checkboxes.
- **On a bulleted line the trigger is the first word, not the first keystroke.** Typing
  `-`/`*`/`+` does not stamp, and neither does the space after it; the bullet is typed
  clean so Obsidian renders the list, and the stamp arrives with the text that follows:
  `- [3:05](…) the thing they said`. Stamping on the bullet itself produced
  `[3:05](…) -`, which never renders as a list at all.
- Whitespace never triggers a stamp. A space is not the start of a thought.
- Does not fire when typing into a line that already has content: that is editing, not
  starting a thought.
- Uses the existing `timestampText()` and `timestampFormat` setting — no new format.
- One stamp per line. A line that already carries a stamp is never stamped again.

### 2. Lookback offset

You decide something is worth noting several seconds after you hear it, so a raw capture
always lands past the thing you wanted.

**The displayed time and the seek target are different numbers.** `{ts}` shows the moment
you wrote the line, because that is what you scan for when reading the note back. `{link}`
and `{seconds}` point `lookbackSeconds` earlier, so clicking drops you in just before it.
Reading and replaying want different answers, so they get different answers: a line that
reads `3:05` seeks to `3:00`.

- Default **5 seconds**. Clamped to `>= 0` so the start of a video can't produce a
  negative seek.
- Applies to auto-stamps **and** to the existing command and player button, so all three
  paths agree.

### 3. Pause while typing

Typing **anywhere** in a note that contains an active player pauses playback. Playback
resumes after a short idle period with no keystrokes.

- Scope is the whole note, not just the stamped line. Any typed character in a note
  containing an active player counts.
- **Enter does not pause.** Breaking a line is not typing. Pausing hangs off character
  input, not off document changes, which also means a sync or another plugin writing to
  the note leaves playback alone.
- Idle resume delay: default **2000 ms**, configurable.
- **Only resume if we were the one who paused.** Track a `pausedByTyping` flag. If the
  user paused the video themselves, typing must not silently restart it.
- Side effect worth naming: with this on, the video position does not drift while you
  type, so the lookback offset stays meaningful for long lines instead of compounding.

## Interaction the implementation must get right

**Play/pause state must not be part of the stamp decision at all.**

Pause-while-typing means the player is paused for most of the time you are actually
writing, and the user may also pause by hand to think. Any play-state condition in the gate
silently stops stamping during normal use. "Where the video is right now" is well defined
whether it is playing or paused, so the gate simply doesn't ask.

The one guard kept is `hasPlayed`: a note whose video was never started would otherwise
stamp every line 0:00.

Playback still respects a user's own pause — that rule lives in `resumeAfterTyping`, not in
the stamp gate. The two are deliberately separate.

## Guards (this is the "bulletproof" part)

- No player in this note → typing is completely untouched.
- Player exists but was never played → no stamp.
- Cursor inside a fenced code block → no stamp.
- Current line already contains a `ytfree:` link → no stamp.
- Typing into a line that already has content → no stamp.
- The whole stamping path is wrapped in try/catch that **falls through to typing the
  character normally**. A bug in this feature must never eat a keystroke.
- Each behaviour has its own kill switch in settings.

## Settings to add

| Key | Default | Description |
|---|---|---|
| `autoStampNewLine` | `true` | Stamp each new line while a player is active |
| `lookbackSeconds` | `5` | Seconds subtracted from the captured position |
| `pauseWhileTyping` | `true` | Pause playback while typing in the note |
| `resumeIdleMs` | `2000` | Idle time before playback resumes |

`lookbackSeconds` should be a slider, not a text field — it wants tuning against real
notes. 5s is a guess, not a measured value: likely right for lectures and podcasts, likely
too long for dense tutorials where 2-3s of audio carries a whole step.

## What stays unchanged

The `insert-timestamp` command and the player's Timestamp button both remain. They are the
deliberate, out-of-flow path: Reading view, retroactive stamps, stamping mid-line. Auto-
stamp becomes the default path, not the only one.

## Implementation notes

- Stamp insertion: `EditorView.inputHandler` at `Prec.highest`, registered via
  `registerEditorExtension`. `inputHandler` sees real typing and not programmatic edits,
  which is exactly the distinction the trigger needs. No keymap, no Enter binding.
- It runs on every keystroke, so order the checks by cost: the line-shape test
  (`stampInsertOffset`) rejects every character after the first on a line without touching
  the player, the workspace, or the document as a whole. The fence scan runs at most once
  per line.
- Typing detection for pause: the *same* `inputHandler`, called before the stamp logic and
  regardless of its outcome. Not `updateListener` — that fires for Enter and for
  programmatic writes, both of which must not pause. Debounce the resume timer; do not
  spawn one timer per keystroke.
- Resolving "which player is in this note": `activePlayer()` / `lastActiveVideoId` already
  exist in `src/main.ts` but are global-ish. This issue needs note-scoped resolution —
  check whether the active `MarkdownView`'s file actually owns the player before acting.
  Expect to have to tighten that lookup.
- Clean up the resume timer in `onunload()` and on view close.

## Acceptance criteria

1. Typing the first character on a line in a note whose video has been played inserts a
   correctly-formatted, clickable timestamp ahead of that character, with the cursor left
   after the typed character.
2. This works on the **first line of a note**, with no Enter pressed at any point.
3. Enter itself is unmodified: it breaks the line and nothing else.
4. The inserted timestamp *displays* the playback position at capture; its link points to
   that position minus `lookbackSeconds`, floored at 0.
5. Clicking an auto-inserted timestamp seeks the player to the link's position.
6. Stamping works identically whether the video is playing, paused by typing, or paused by
   the user.
7. A note whose video has never been played does not stamp anything.
8. Typing any character in a note with an active player pauses playback within one
   keystroke; playback resumes `resumeIdleMs` after the last keystroke.
9. If the user pauses the video manually, typing and then stopping does **not** resume it.
10. Typing in a note with no ytfree player behaves exactly like stock Obsidian.
11. Typing inside a fenced code block inserts no timestamp.
12. A line that already contains a `ytfree:` timestamp never gets a second one, and typing
    into the middle or start of a line that already has content never stamps.
13. Typing `-`, `*` or `+` on an empty line, then a space, produces a clean bullet with no
    stamp; the first word typed after it is stamped, and the list still renders. The same
    holds for an auto-continued bullet and for a checkbox (`- [ ] `).
14. Pressing Enter never pauses the video; only typing a character does.
15. `{ts}` renders the moment the line was written while the link seeks `lookbackSeconds`
    earlier — a line reading `3:05` navigates to `3:00`.
16. Turning off `autoStampNewLine` stops stamping; turning off `pauseWhileTyping` leaves
    playback running while typing; each is independent.
17. `lookbackSeconds` applies equally to the `insert-timestamp` command and the player's
    Timestamp button.
18. Unit tests cover the trigger shape, the gate logic and the lookback clamp. `npm test`
    stays green.

## Manual test (for BarkernotBob)

Reload Obsidian first (Settings → Community plugins → toggle YT Free off and on), so the
new build is loaded. Make a scratch note with a ` ```ytfree ` block and a video you know.

**A. The main thing — no Enter involved**
1. Play the video. Let it run ~30 seconds.
2. Click on an **empty first line above the player** and just start typing a few words.
3. **Expect:** the timestamp appears the moment you type the first character, ahead of what
   you typed, and your typing continues normally after it. You never pressed Enter.
4. Press Enter, type a few more words. Repeat once more.
5. **Expect:** each line carries its own timestamp, matching where the video was when you
   started that line. (The 5-second lookback is in the click target, not the text — see G.)
6. Look at the moment Enter itself happens. **Expect:** Enter just breaks the line. Nothing
   is written until you type.

**B. Play/pause must not matter** (the thing that was broken)
7. Pause the video yourself. Press Enter and type a new line.
   **Expect:** it still stamps, at the paused position.
8. Play again, type mid-sentence so pause-while-typing kicks in, press Enter, keep typing.
   **Expect:** it still stamps. No line is silently skipped.
9. Open a note with a ytfree block you have **never pressed play on**. Type a line.
   **Expect:** no timestamp at all. (No note full of 0:00.)

**C. The pause**
10. While the video is playing, start typing a long sentence.
    **Expect:** the video pauses on the first character, and starts again about two seconds
    after you stop.
11. Type in the middle of an existing line. **Expect:** it still pauses, and adds no stamp.

**D. Your own pause is respected**
12. Pause the video yourself with the Play/Pause button.
13. Type a sentence, then stop and wait five seconds.
    **Expect:** the video stays paused. It must not start playing on its own.

**E. Clicking back**
14. Click one of the timestamps you created. **Expect:** the video jumps there and plays.

**F. Bulleted lists and Enter**
15. On an empty line, type `-`, then a space, then some words.
    **Expect:** the `-` and the space appear on their own with no timestamp, Obsidian turns
    the line into a bullet, and the timestamp appears with your first word — after the
    bullet: `- [3:05](…) your words`. Press Enter and type again.
    **Expect:** the auto-continued bullet behaves the same way.
16. Press Enter several times in a row while the video plays, without typing anything.
    **Expect:** the video keeps playing. Enter must not pause it.

**G. Displayed time vs. click target**
17. Start a new line and note the timestamp it shows, and where the video actually was.
    **Expect:** the timestamp reads the moment you started typing — not five seconds
    earlier.
18. Click that timestamp. **Expect:** the video jumps to about five seconds *before* the
    time shown. Reading and replaying are meant to differ.

**H. Nothing else is broken**
19. Open any note with no video in it. Type, press Enter, type again.
    **Expect:** completely normal. No timestamps, no lag, no swallowed characters.
20. Click inside the ` ```ytfree ` block and type. **Expect:** no timestamp.
21. Click into the middle of a line you already wrote and type. **Expect:** no second
    timestamp on that line.

**I. The switches**
22. Settings → YT Free → Flow capture. Turn **Timestamp every new line** off, then type.
    **Expect:** normal typing, no stamps; the Timestamp button still works.
23. Turn it back on, turn **Pause while typing** off.
    **Expect:** stamping still works, but the video keeps playing while you type.
24. Turn both back on. Drag **Lookback** to 0 and start a new line, then click the stamp.
    **Expect:** the displayed time and the place it lands are now the same.

Report which numbered steps fail, and what happened instead.

Tune note: if 5 seconds of lookback consistently lands too early or too late for the
content you watch, change the Lookback slider rather than reporting it as a bug — that
number was a guess, not a measurement.
