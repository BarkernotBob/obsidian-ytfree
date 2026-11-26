# V1 scope: Cinema design language

Isaiah, 2026-11-26: picked direction **B · Cinema** from the mockups
(https://claude.ai/artifact/885i4Fd9QT1oDGTtoG3wez), with one firm note: **always show the whole
video title.** Priority 2, after the plugin description and settings cleanup.

## The idea in one line

The video is the hero: big 16:9 pictures, a dark stage for anything that plays, controls that float
on the picture, and soft pill controls. Everything outside the stage stays on Obsidian's theme
variables, so it works in light, dark and community themes.

## Principles

1. **Whole titles.** No ellipsis and no line clamp on a video title anywhere: hub, search, channel,
   Preview, Manage subscriptions. Cards grow to fit.
2. **Picture first.** On a phone a card is a full-width 16:9 thumbnail with the title and channel
   under it. On desktop the same card in a grid (2 to 4 columns by width).
3. **The stage is always dark.** The player and the Preview's picture area are black in every theme.
   Nothing else is.
4. **Controls float on the picture.** A scrim, a centred back / play / forward cluster, and one
   bottom row. They hide while playing and come back on a tap or a pointer move.
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
- Phone, overlaid on the picture: centre cluster −10 / Play / +10; bottom row time, speed pill,
  fullscreen, Options. Hub, PiP, HD, Collapse and Share move into the Options pop-out.
- Desktop: same layout; the bottom row has room for PiP and HD as well.
- Auto-hide after 3 s of playing; tap (phone) or pointer move (desktop) shows them. Paused always
  shows them. This reuses the existing immersive-mode floating bar and the #132 poster tap rules.
- YouTube's embedded player (the fallback) keeps YouTube's own controls. Ours are not drawn over it.

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
| Controls over a 16:9 phone picture (about 220 pt tall) | Only 7 controls on the picture; the rest go in Options. 44 pt targets. |
| `backdrop-filter` blur on the play button costs GPU over video on older phones | Solid translucent fill as the base style; blur only on desktop. |
| Store linter | No new inline styles (sizes go through CSS variables, as the progress bar and pinned height already do), no `!important`, no `:has`. Fixed black and white on the stage are plain colours, which the linter allows. |
| Floating UI clipped in Live Preview (`contain: paint`) | Controls sit inside the player box, so they are not affected. Pop-outs already lift to `document.body`. |
| Community themes | Every colour outside the stage is an Obsidian variable. Check in Default, Minimal and AnuPpuccin, light and dark. |

## Manual test (phone, then desktop)
1. Open the hub. Each card shows a full-width picture and its **whole** title, however long.
2. Tap each filter pill. The list changes; the pills wrap if they need two lines; nothing scrolls sideways.
3. Open a video note and play. Controls float on the picture and hide after about 3 s. Tap the
   picture: they come back. Tap Pause: they stay.
4. Open Options. Hub, PiP, HD, Collapse and Share are there.
5. Switch Obsidian to light, then dark. The stage stays black; everything else follows the theme.
6. Desktop: open Preview. Video on the right, whole title and actions on the left.
7. Search and a channel screen show the same cards as the hub.
