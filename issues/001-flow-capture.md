# 001 — Flow capture: auto-timestamp new lines, pause while typing

**Status:** Open. Blocked on the v1 manual test (`docs/MANUAL-TEST.md`) passing.
Nothing here gets built until real playback inside Obsidian is confirmed.

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

When you press Enter in a note that contains an active ytfree player, the new line is
created with the timestamp already on it and the cursor placed after it. You just type.

- Stamp at **line start**, not line end. Enter-time is the moment immediately before you
  write the thought, which is the correct anchor. Stamping the line you are *leaving*
  would be wrong by however long you took to type it.
- Uses the existing `timestampText()` and `timestampFormat` setting — no new format.
- One stamp per line. A line that already carries a stamp is never stamped again.

### 2. Lookback offset

Subtract a fixed offset from the captured position before formatting. You decide something
is worth noting several seconds after you hear it; stamping at keypress time always lands
past the thing you wanted.

- Default **5 seconds**. Clamped to `>= 0` so the start of a video can't produce a
  negative seek.
- Applies to auto-stamps **and** to the existing command and player button, so all three
  paths agree.

### 3. Pause while typing

Typing **anywhere** in a note that contains an active player pauses playback. Playback
resumes after a short idle period with no keystrokes.

- Scope is the whole note, not just the stamped line. Any keystroke in the editor of a
  note containing an active player counts.
- Idle resume delay: default **2000 ms**, configurable.
- **Only resume if we were the one who paused.** Track a `pausedByTyping` flag. If the
  user paused the video themselves, typing must not silently restart it.
- Side effect worth naming: with this on, the video position does not drift while you
  type, so the lookback offset stays meaningful for long lines instead of compounding.

## Interaction the implementation must get right

With pause-while-typing on, by the time you press Enter the video is **paused** — paused by
us. So the gate for auto-stamping cannot be `!video.paused`. It must be:

> the note has a player AND (the player is playing OR the player is `pausedByTyping`)

Getting this wrong means auto-stamp silently stops working the moment pause-while-typing
is enabled, which is the default. This is the most likely bug in the whole issue.

## Guards (this is the "bulletproof" part)

- No player in this note → Enter is completely untouched.
- Player exists but is user-paused (not `pausedByTyping`) → no stamp.
- Cursor inside a ` ```ytfree ` fenced block → no stamp.
- Current line already contains a `ytfree:` link → no stamp.
- The whole stamping path is wrapped in try/catch that **falls through to normal Enter**.
  A bug in this feature must never break the Enter key.
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

- Enter interception: CodeMirror 6 keymap registered via `this.registerEditorExtension`,
  at higher precedence than the default Enter binding. Not `editor-change` — that fires
  after the fact and can't cleanly own the newline.
- Typing detection for pause: the same editor extension, or an `editor-change` workspace
  event. Debounce the resume timer; do not spawn one timer per keystroke.
- Resolving "which player is in this note": `activePlayer()` / `lastActiveVideoId` already
  exist in `src/main.ts` but are global-ish. This issue needs note-scoped resolution —
  check whether the active `MarkdownView`'s file actually owns the player before acting.
  Expect to have to tighten that lookup.
- Clean up the resume timer in `onunload()` and on view close.

## Acceptance criteria

1. With a video playing, pressing Enter in the note creates a new line already prefixed
   with a correctly-formatted, clickable timestamp, cursor positioned after it.
2. The inserted timestamp equals the playback position minus `lookbackSeconds`, floored at
   0.
3. Clicking an auto-inserted timestamp seeks the player to that position.
4. Typing any character in a note with an active player pauses playback within one
   keystroke; playback resumes `resumeIdleMs` after the last keystroke.
5. If the user pauses the video manually, typing and then stopping does **not** resume it.
6. Auto-stamp still fires when the video is paused *by typing* (the interaction case
   above).
7. Pressing Enter in a note with no ytfree player behaves exactly like stock Obsidian.
8. Pressing Enter with the cursor inside a ` ```ytfree ` block inserts no timestamp.
9. Pressing Enter on a line that already contains a `ytfree:` timestamp inserts no second
   timestamp.
10. Turning off `autoStampNewLine` restores stock Enter behaviour; turning off
    `pauseWhileTyping` leaves playback running while typing; each is independent.
11. `lookbackSeconds` applies equally to the `insert-timestamp` command and the player's
    Timestamp button.
12. Unit tests cover the gate logic and the lookback clamp. `npm test` stays green.

## Manual test (for BarkernotBob)

To be written when this issue is complete, per the backlog rule.
