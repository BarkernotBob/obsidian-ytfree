# V1 scope: Cinema design language

Isaiah, 2026-11-26: picked direction **B · Cinema** from the mockups
(https://claude.ai/artifact/885i4Fd9QT1oDGTtoG3wez), with one firm note: **always show the whole
video title.** Priority 2, after the plugin description and settings cleanup.

## The idea in one line

The video is the hero: big 16:9 pictures, a dark stage for anything that plays with its controls
in a dark strip underneath, and soft pill controls. Everything outside the stage stays on Obsidian's theme
variables, so it works in light, dark and community themes.

## Principles

1. **Whole titles.** No ellipsis and no line clamp on a video title anywhere: hub, search, channel,
   Preview, Manage subscriptions. Cards grow to fit.
2. **Picture first.** On a phone a card is a full-width 16:9 thumbnail with the title and channel
   under it. On desktop the same card in a grid (2 to 4 columns by width).
3. **The stage is always dark.** The player and the Preview's picture area are black in every theme.
   Nothing else is.
4. **Transport on the picture, tools under it.** Back 10 / Play / Forward 10 sit on the picture with
   Play at its exact centre. Everything else is in a dark strip under the video that never hides
   (Isaiah, 2026-11-26).
7. **One spacing scale and real centring.** Gaps are 4, 8, 12, 16, 24 or 32 px, nothing else. Rows
   with a middle item use a `1fr auto 1fr` grid so the middle item is centred whatever is beside it.
5. **Pills.** Filters, speed and secondary actions are rounded pills. The selected pill is filled
   with the text colour.
6. **One accent.** Obsidian's accent is used for progress only.

## In v1

### Hub and lists (hub, search, channel screen)
- Phone: one column of full-width cards. Thumbnail, then a 2-column row: channel initial in a
  coloured circle, and the whole title with "Channel · age" under it. Dismiss × at the end of the row.
- Desktop and tablet: the same card in a responsive grid.
- Thumbnails move from `mqdefault` (320 px) to `hqdefault` (480 px, cropped to 16:9) so they are
  not blurry at full width. Images stay lazy-loaded.
- Duration badge and progress bar stay on the thumbnail. Saved marker stays top-left.
- Filter pills replace the phone's disclosure button for the six filters (Inbox, In progress, Saved,
  Hidden, History, Everything). They **wrap onto a second line** rather than scroll sideways (the
  no-horizontal-scroll rule in MOBILE-UX.md stands). The channel list keeps its own button.

### Player (note, Preview, pinned)
- **On the picture:** Back 10, Play, Forward 10. Play is 56 px, at the exact centre; back and
  forward are 40 px, 24 px either side. Shown while paused; while playing they fade after 3 s and a
  tap on the picture brings them back. Hidden when YouTube's embedded player (the fallback) is
  showing, so they never block YouTube's own controls.
- **Strip row 1:** elapsed time, seek bar, total time.
- **Fullscreen** sits in the picture's bottom-right corner (36 px), so the tools row is symmetric.
- **Strip row 2 (tools):** a 7-column grid, `repeat(3, 1fr) 72px repeat(3, 1fr)`: Hub, PiP, HD |
  speed | Collapse, Share, Options. The speed pill is a fixed 72 px wide with its value centred, so
  1×, 1.25×, 1.75× and 2× all sit in the same place and nothing beside it moves. On a phone this replaces today's transport row and side row, so the
  player loses a row.
- **Strip row 3 (notes only):** Notes, Description, Transcript, This moment as four equal
  icon-over-label buttons (22 px icon, 12 px label, 56 px tall, no outline; Isaiah, 2026-11-26).
  Same behaviour as today's section links (Notes still folds the video only while the keyboard is up).
- No button is removed and none moves into Options.

### Preview
- Phone sheet: player on top, then the whole title and facts, then Watch / Save / Remove as three
  equal pills, then **Description | Transcript** tabs. The transcript highlights the line playing.
- Desktop (#133 folds in here): follows the theme (only the player is dark). 32 px margins, two
  columns at 5:7, 32 px apart. Left: whole title (22 px), facts, action pills, the two tabs. Right:
  the player with the same transport and strip. Each block on the left is 24 px from the next.
- Card actions on hub cards (Preview, Watch, Save, Remove) stay; one row of four equal
  icon-over-label buttons, same style as the section buttons. Save's done state is accent colour.

### Settings
- **No restyle.** On Obsidian 1.13+ Obsidian draws the settings tab itself from our definitions, in
  its own grouped look. Only the copy changes, and that belongs to the settings cleanup thread.

## Not in v1
- Real channel avatars. The hub does not store them; fetching them is extra requests per channel
  (request budget, #31 to #39). v1 uses the coloured initial. Post-MVP issue.
- `maxresdefault` / `hq720` thumbnails (not every video has one; needs a fallback chain).
- Animation beyond a fade on the controls.
- Changes to Manage subscriptions beyond whole titles.

## What could go wrong, and the answer

| Risk | Answer |
|---|---|
| Fewer cards per phone screen (about 2.5, from about 7) | Accepted with the pick. Lazy images keep scrolling smooth. |
| Variable card heights from whole titles | The hub has no fixed-height virtual list; the paging sentinel is an IntersectionObserver, so it is unaffected. |
| Buttons on the picture over a phone video | Only three, centred, 40 to 56 px; Obsidian already handles the poster tap (#132) and the floating fullscreen bar, so this is the same kind of positioned element inside the player box. |
| Tools row on a narrow phone | 7 icons plus speed need about 310 pt at 36 pt each; a 390 pt phone has 366 pt. On the narrowest phones (320 pt) the icons drop to 32 pt. |
| Store linter | No new inline styles (sizes go through CSS variables, as the progress bar and pinned height already do), no `!important`, no `:has`. Fixed black and white on the stage are plain colours, which the linter allows. |
| Floating UI clipped in Live Preview (`contain: paint`) | Controls sit inside the player box, so they are not affected. Pop-outs already lift to `document.body`. |
| Community themes | Every colour outside the stage is an Obsidian variable. Check in Default, Minimal and AnuPpuccin, light and dark. |

## Manual test (phone, then desktop)
1. Open the hub. Each card shows a full-width picture and its **whole** title, however long.
2. Tap each filter pill. The list changes; the pills wrap if they need two lines; nothing scrolls sideways.
3. Open a video note. Play is in the exact centre of the picture, with back and forward the same
   distance either side. Play: they fade after about 3 s; tap the picture and they come back.
4. Under the picture: the seek bar, then one row with speed in the middle (Hub, PiP, Fullscreen
   left; HD, Collapse, Share, Options right), then Notes, Description, Transcript, This moment.
   Each of those buttons still does what it does today.
   Change the speed through 1×, 1.25×, 1.75× and 2×: the pill and the icons beside it do not move.
   No button label is cut off.
5. Desktop Preview: nothing touches anything else; the title, actions and tabs line up on one
   left edge, and the tabs switch between Description and Transcript.
6. Switch Obsidian to light, then dark. The stage stays black; everything else follows the theme.
7. Desktop: open Preview. Video on the right, whole title and actions on the left.
8. Search and a channel screen show the same cards as the hub.
