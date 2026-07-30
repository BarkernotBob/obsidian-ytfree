# 019 — A line, a rotation, and the dials where you are watching

Status: **Built 2026-07-30 — awaiting manual test.**

Four items off BarkernotBob's list. The first corrects something 017 shipped.

> 1. Make sure the trash after a month is durable enough to understand that
>    frontmatter, transcript, top moments etc can all be there and a note still
>    need trashed. It's only to be kept if I wrote in the notes header.
> 2. Add a small purple progress bar that tracks along the bottom of the video
>    to show how far along you are. This should only show if the video is not in
>    full screen mode.
> 3. Entering landscape orientation on mobile (not iPad size just phone) should
>    immediately throw the video into full screen.
> 4. On the under video controls, add a button that takes you directly to
>    settings for the extension, and another that just gives me quick per video
>    adjustment in a small pop out.

---

## 1. The tidy asks one question now

017 asked four. Three of them could keep a note the reader had never written a
word in:

- **a tag in the frontmatter** counted as writing. The plugin writes the
  frontmatter, and `tags: []` is one edit away from `tags: [video]` by a
  template, a plugin, or a sweep of your own;
- **anything above the first heading** counted as writing — which is where the
  **Most replayed** section goes. Every note with a heatmap in it was
  permanently safe;
- **the file's modified time** reset the month. The plugin writes to these
  notes itself: a transcript fetched a fortnight after you watched, or a
  heatmap backfilled on open, moved the clock on a note nobody had touched.

So the rule is now the one sentence BarkernotBob wrote it as: **is there anything
under `# Notes`?** Frontmatter, description, transcript, most-replayed moments —
all of it can be present, and long, and the note still goes. The single
uncertainty still answers "keep": a note with no `# Notes` heading at all is not
shaped like ours, so there is nothing to judge.

The three conditions that remain: played, over a month ago, nothing under
`# Notes`, and not open in front of you.

## 2. The purple line

Three pixels along the foot of the picture, filled from the left, in
`--ytfree-progress-color` (a purple you can override in a snippet).

It sits inside the media box rather than in the note's column — mobile already
had such a box, the desktop now gets a bare `.ytfree-stage` that is exactly the
video's size — so it is out of the flow and costs the note no height whether it
is drawn or not. It advances by `transform: scaleX()`, which is composited and
reflows nothing four times a second for the length of a two-hour video, and it
is `pointer-events: none` so it can never take a tap meant for the scrubber
under it. `seeked` repaints it as well as `timeupdate`, because a Smart Speed
skip moves the position without playing through it.

Fullscreen hides it for free: fullscreen is requested on the `<video>` element
itself, and a sibling of the fullscreen element is not rendered at all. The
`:fullscreen` rules in the stylesheet are a belt on top of that.

It stays hidden until the media reports a duration, so an unresolved player
does not show an empty track across its poster.

## 3. Sideways is a request to watch

`Platform.isPhone` only — an iPad in landscape is a note beside a video, and
that is the point of the layout. On the orientation change, if a player on
screen has actually been playing, it is asked to go fullscreen.

**This one may not work, and the reason is not ours.** iOS refuses a fullscreen
request that has no user gesture behind it, and a rotation is not a gesture on
any platform's reckoning. `enterFullscreen` fails quietly by design, so the
worst case is that nothing happens and the button still works. Step 5 of the
manual test is what decides which it is. Speculation, clearly labelled: I expect
it to work on Android/Chromium and to be refused on iOS, and I would rather ship
the attempt than the guess.

Turning back to portrait does **not** leave fullscreen. Leaving is what the
native Done button is for, and a plugin that yanked you out of fullscreen every
time the phone wobbled would be worse than one that never put you there.

## 4. Two buttons under the video

**Settings** (gear, left group) opens Obsidian's settings on this plugin's tab.
`app.setting` is internal, so both calls are guarded and the fallback is a
notice telling you where to go by hand.

**This video's settings** (sliders, right group) opens a pop-out over the
picture with the dials you change while something is playing:

| Control | What it does |
|---|---|
| Smart Speed | The same state as the bar's toggle, in switch form. The two are painted from one place, so they cannot disagree. |
| Skip music too | Per video. Changes which windows exist rather than how they are filtered, so the map is recombined from what is already stored — no refetch. |
| Pause speed | How fast an instrumental plays. |
| Shortest pause | The minimum gap worth compressing. |
| Player size | The height, live, for this player. |

**Nothing in the pop-out writes a setting.** "No music skipping on this lecture"
and "no music skipping ever" are different decisions, and the second one belongs
in the settings screen the button beside it opens. The footnote in the panel says
*This video only* for the same reason. Everything resets when the note is closed.

The panel is built at construction and hidden with `visibility`, not created on
the click and never `display: none`: it is absolutely positioned off the control
row, so opening it moves nothing — `tools/controls-harness.mjs` now measures the
bar's height with the panel open and shut and reports the difference, which is
0 at every width. It opens upwards over the video, because the video is the one
thing on screen you are not reading while you are changing how it plays. A tap
anywhere else, or Escape, closes it.

The row itself went from seven controls to nine on a phone. It still fits: at
375 pt the two-row layout measures no overflow, every target at its full 40 pt,
8 pt between neighbours, and 23 pt of slack left over.

---

## Acceptance criteria

- [x] A watched note with a full transcript, a description, a heatmap and a
      frontmatter full of tags is still trashed when nothing is under `# Notes`.
- [x] A note edited last night — by the plugin or anyone else — is trashed on
      the same terms; only writing under `# Notes` keeps it.
- [x] A note with no `# Notes` heading is never trashed.
- [x] A purple line tracks playback along the bottom of the picture.
- [x] The line is not visible in fullscreen.
- [x] The line adds no height to the note and takes no taps.
- [x] The line keeps up with a Smart Speed skip, not just with playback.
- [x] Turning a phone sideways puts a playing video into fullscreen, or does
      nothing at all — never an error over the picture.
- [x] An iPad is unaffected.
- [x] A gear button opens the plugin's settings tab.
- [x] A pop-out offers Smart Speed, Skip music, pause speed, shortest pause and
      player size, for this video only.
- [x] Opening or closing the pop-out changes no other control's position, and
      the bar's height does not change — measured, at four widths.
- [x] The control row does not overflow a 375 pt phone with two more buttons on
      it — measured.
- [x] `npm run check` clean: 328 tests.

## Manual test (for BarkernotBob)

**The line (either device)**

1. Play anything. A purple line should creep along the bottom edge of the
   picture. Scrub the native scrubber — the line should jump with it, not lag.
2. With Smart Speed on, watch it cross a silence: the line should jump the same
   distance the video does.
3. Go fullscreen. No purple line. Come back — it is there again, in the right
   place.

**The phone**

4. Turn the phone sideways while a video is playing. Either it goes fullscreen
   (good) or nothing happens (expected on iOS). **Tell me which**, because
   "nothing happens" is the answer that decides whether item 3 is closed or
   whether it needs a different mechanism.
5. Turn it back to portrait. Nothing should be yanked out from under you.

**The two buttons (either device)**

6. Tap the gear. Obsidian's settings should open on YT Free's own tab.
7. Tap the sliders button. A small panel opens over the video. Nothing else on
   the row moves, and the note text below does not shift by a pixel.
8. Flip **Smart Speed** in the panel. The zap on the bar should change with it.
   Flip it on the bar — the switch should follow.
9. Turn **Skip music too** off on a video with an instrumental in it. The music
   should stop being skipped without anything being refetched.
10. Drag **Player size**. The player should resize under your finger. Close the
    note and open it again: it should be back to the setting's size, not the
    one you dragged to. That is deliberate.
11. Tap the note behind the panel, or press Escape. The panel closes.

**The tidy**

12. Take a video note you watched and never wrote in — transcript, description,
    heatmap, tags, all present — and prove it: set *Tidy empty notes after* to
    **5**, backdate that video's `watched` stamp in
    `.obsidian/plugins/ytfree/progress.json` by a week, and run **Tidy watched
    video notes with nothing written in them**. The note should go to the trash
    even though it is full of plugin-written content. Put the setting back to
    30 afterwards.
13. Write one line under `# Notes` in another such note and repeat. That one
    must survive.
