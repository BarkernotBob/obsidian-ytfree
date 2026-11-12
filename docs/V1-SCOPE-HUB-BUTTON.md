# V1 scope: a hub button on every player bar (2026-11-12, MVP)

Isaiah: "a video note always needs a button to nav back to the hub. This should be part of the
button bar." Grilled 2026-11-12; mockup: https://claude.ai/artifact/As4pnLruKYMygrKUsKbYma

## v1

- A grid icon (four squares, Obsidian's `layout-grid`), first on the left of the player's control bar,
  titled "Back to the hub". Every video note gets it, and so does the Preview window.
- Tap in a **video note**: the hub tab comes forward (or opens if there is none), exactly like the
  ribbon icon. The note tab stays open and the video **keeps playing**.
- Tap in **Preview**: the sheet closes by its own close rule (the video stops and its spot is saved,
  unless it is in Picture-in-Picture, which plays on), then the hub comes forward.
- **Equal spacing.** Every pair of neighbouring controls on the bar has the same gap. The bar is one
  flex row with `space-between` (the groups are `display: contents`), replacing the `1fr auto 1fr`
  grid whose gaps were 8px inside groups and wider between them. Play stays within ~6px of centre.
- **Phone (≤460px):** the side row cannot take a ninth 40pt target (8 × 40 + 44 > 347pt on a 375pt
  phone), so the hub button sits at the **left end of the transport row** (top-left of the bar),
  and the seven side controls spread evenly across the row below.
- Visible while YouTube's player is showing (which hides every other control but the YouTube button).
- Hidden in the plugin's own sideways fullscreen: leaving it comes first.

Measured in Chromium with the plugin's stylesheet: no overflow at 375/390/430/640/900px; phone side
row gaps 10–11px at 375, 13px at 390; desktop gaps equal.

## Not in v1

- The bar is hidden while the phone keyboard is up (existing rule), so the button is too.
- No hub button in fenced players outside a note (exports).

## Manual test

Phone (iPhone):
1. Open a video note. The grid button is at the top-left of the bar, level with −10s / Play.
   The bottom row (speed, PiP, Fullscreen, YouTube, Collapse, Share, Options) is evenly spaced.
2. Play the video, tap the grid button. The hub shows; the sound keeps going.
3. Switch back to the note's tab: it is where you left it, still playing.
4. Tap the YouTube button, then the grid button: still visible and still goes to the hub.
5. In the hub, open a Preview, play it, tap the grid button: the sheet closes, the sound stops,
   the hub is showing. Reopen Preview: it resumes where it stopped.
6. Preview in Picture-in-Picture, tap grid: sheet closes, PiP keeps playing.

Mac:
7. Open a video note. Grid button first on the left; all gaps along the bar look the same.
8. Tap it with the hub tab already open: that tab comes forward, no second hub tab.
9. Close the hub tab, tap it again: a new hub tab opens.
