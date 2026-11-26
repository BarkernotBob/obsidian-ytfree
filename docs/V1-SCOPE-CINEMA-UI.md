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
4. **Controls always visible, under the picture.** They sit in a dark strip that is part of the
   stage, never over the video and never hidden (Isaiah, 2026-11-26). Only the plugin's own
   fullscreen keeps today's floating bar.
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
- Same buttons as today, in the same places: no button moves into Options.
- Restyled as a dark strip under the picture: progress bar, then elapsed and total time, then the
  controls. Play is a white circle; the rest are light icons on the dark strip.
- Phone: two rows as today (transport row with −10 / Play / +10 / speed, then the side row).
  Desktop: one row.
- The strip is always visible, playing or paused. No auto-hide.
- YouTube's embedded player (the fallback) keeps YouTube's own controls inside the picture; our
  strip stays under it as today.

### Preview
- Desktop (#133 folds in here): dark modal, video on the right two-thirds, whole title, facts,
  pill actions and description on the left over a dark gradient.
- Phone: dark sheet, video on top, whole title under it (replaces today's one-line ellipsis,
  which needs the grid layout changed, not just the clamp removed).

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
| The dark strip adds height under a phone video | Same two rows as today, so no height is added. |
| Store linter | No new inline styles (sizes go through CSS variables, as the progress bar and pinned height already do), no `!important`, no `:has`. Fixed black and white on the stage are plain colours, which the linter allows. |
| Floating UI clipped in Live Preview (`contain: paint`) | Controls sit inside the player box, so they are not affected. Pop-outs already lift to `document.body`. |
| Community themes | Every colour outside the stage is an Obsidian variable. Check in Default, Minimal and AnuPpuccin, light and dark. |

## Manual test (phone, then desktop)
1. Open the hub. Each card shows a full-width picture and its **whole** title, however long.
2. Tap each filter pill. The list changes; the pills wrap if they need two lines; nothing scrolls sideways.
3. Open a video note and play. The controls sit in a dark strip under the picture and stay
   visible the whole time, playing or paused. Nothing covers the video.
4. Every button from before is still in the strip (Hub, PiP, Fullscreen, −10, Play, +10, speed,
   HD, Collapse, Share, Options).
5. Switch Obsidian to light, then dark. The stage stays black; everything else follows the theme.
6. Desktop: open Preview. Video on the right, whole title and actions on the left.
7. Search and a channel screen show the same cards as the hub.
