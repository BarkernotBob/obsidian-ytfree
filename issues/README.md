# Issues — obsidian-ytfree

Backlog index. One file per issue. Numbered in creation order, not priority order.

| # | Title | Status |
|---|---|---|
| [001](001-flow-capture.md) | Flow capture: auto-timestamp new lines, pause while typing | Built — awaiting manual test |
| [002](002-local-download.md) | Download a video for offline, and play the local copy | Built — awaiting manual test |
| 003 | Subscriptions hub: poll subscribed channels, click a video into a note | Built ([docs/V1-SCOPE-SUBSCRIPTIONS.md](../docs/V1-SCOPE-SUBSCRIPTIONS.md)) — awaiting manual test. *No issue file; scope doc is the record* |
| [004](004-mobile-viewer.md) | A viewer that works on Obsidian mobile — InnerTube resolve + `<video>`, ad-free, 360p | Built 2026-07-28 — awaiting manual test. **Untried on a real iPhone.** |
| [005](005-mobile-full-quality.md) | Full quality on mobile (above 360p) via MSE | Scoped — not built, blocked on 004 |
| 006 | Sign in to YouTube; import subscriptions, Watch Later and history | **Built** ([docs/V1-SCOPE-ACCOUNT-IMPORT.md](../docs/V1-SCOPE-ACCOUNT-IMPORT.md)) — `syncAccount` in `main.ts`. Index said "not built" until 2026-09-01; it shipped. Faults found since → [044](044-subscription-sync-recovery-and-removals.md) |
| [007](007-browse-search.md) | Browse: search YouTube from inside the hub, add results as hub items | Built 2026-07-28 ([docs/V1-SCOPE-BROWSE.md](../docs/V1-SCOPE-BROWSE.md)) — awaiting manual test |
| [008](008-browse-round-two.md) | Browse round two: YouTube's filters, a Hidden list, and two search boxes | Built 2026-07-28 — awaiting manual test |
| [009](009-mobile-polish.md) | Mobile polish: dead space, stuck tap greys, an icon control row, quieter rows | Built 2026-07-28 — awaiting manual test |
| [010](010-cards-controls-sections.md) | Hub cards, a designed control bar, and note sections | Built 2026-07-29 — awaiting manual test |
| [011](011-card-trim-and-filter-names.md) | No blurb, a bigger target, and lists that say what they are | Built 2026-07-29 — awaiting manual test |
| [012](012-resume-transcript-and-controls.md) | Where you left off, transcripts on the phone, and a row you can hit | Built 2026-07-29 — awaiting manual test |
| [013](013-heatmap-on-the-phone.md) | Most-replayed moments on the phone, and backfilled without asking | Built 2026-07-29 — awaiting manual test |
| [014](014-hidden-videos-came-back.md) | Hidden videos came back — save is a merge now, not an overwrite | Built 2026-07-29 — awaiting manual test |
| [015](015-smart-speed.md) | Smart Speed: compress pauses like Overcast; ffmpeg optional, never required | Built — tested, superseded in part by 016 |
| [016](016-smart-speed-round-two.md) | Smart Speed round two: skip music too, and analyse faster than playback | Built 2026-07-29 — awaiting manual test |
| [017](017-skip-fold-tidy.md) | Skip the silence, fold the transcript, tidy the leftovers | Built 2026-07-30 — awaiting manual test |
| [018](018-watch-later.md) | What Watch Later is for now | Scoped — needs a decision, nothing built |
| [019](019-progress-bar-landscape-quick-panel.md) | A line, a rotation, and the dials where you are watching | Built 2026-07-30 — awaiting manual test |
| [020](020-controls-tidy-immersive-landscape.md) | The line where you can see it, and a bar you can read | Built 2026-07-30 — awaiting manual test |
| [021](021-restore-pill-seek-drag-pending-play.md) | A way back, a line that lines up, and a Play button that never lies | Built 2026-07-30 — awaiting manual test |
| [022](022-adaptive-silence-floor.md) | Adaptive silence floor: no chipmunks, no swallowed words | Built 2026-07-30 — awaiting manual test (needs BarkernotBob's ears) |
| [023](023-card-controls-layout.md) | Four buttons on every card, and the layout that fits them | Built 2026-07-30 — awaiting manual test |
| [024](024-preview-plays.md) | Preview plays: the standalone player inside the modal | Built 2026-07-31 — awaiting manual test |
| [025](025-dock-audio-badge.md) | A ▶ on the macOS dock icon while audio is playing | Built 2026-07-31 — **verified working**; popout + phone steps outstanding |
| [026](026-delete-removes-from-hub.md) | Deleting a note removes the video from the hub | Built 2026-07-31 — awaiting manual test |
| 027 | Replay peaks skip the opening 10 seconds — every video led with 0:00 | Built 2026-07-31 — awaiting manual test. *No issue file; `LEAD_IN_SECONDS` in `transcript.ts` is the record* |
| [028](028-transcript-in-preview-and-jumps.md) | The transcript in Preview, and a jump from a peak to it | Built 2026-07-31 — awaiting manual test |
| [029](029-share-a-video.md) | Share a video's URL, and share it at the current timestamp | Built 2026-07-31 — awaiting manual test |
| [030](030-preview-transcript-share-and-moment.md) | Preview's transcript at note size, autoscroll you can stop, a share icon that isn't Download, and "this moment" | Built 2026-07-31 — awaiting manual test |
| [032](032-mobile-preview-window.md) | The Preview window on a phone: a pop-out that fits, no sideways scroll, a Collapse that works, one scroller, and PiP that survives closing | Tested 2026-08-06 — clipping fixed, but the sheet is the wrong shape → [037](037-popover-not-a-sheet.md), scroll order → [039](039-transcript-pinned.md) |
| [033](033-search-clarity.md) | A button that says Search, and a screen that looks like one | Built 2026-08-03 — awaiting manual test |
| [034](034-state-that-disagrees-between-devices.md) | State that disagrees between devices: removals that did not cross, and Kept losing watched videos | Built 2026-08-03 — awaiting manual test |
| [035](035-follow-unfold-cursor-progress.md) | The note's transcript follows the video, "this moment" unfolds first, Notes returns to the cursor, and a progress line that reaches both corners | Tested 2026-08-06 — follow and unfold work; resting position → [040](040-this-moment-lands-at-the-top.md), mobile cursor/keyboard → [041](041-notes-button-cursor-and-keyboard.md) |
| [036](036-notify-when-a-video-lands.md) | A notification when a new video lands in the Inbox — one webhook URL, one push per check | Built 2026-08-03 ([docs/V1-SCOPE-NOTIFICATIONS.md](../docs/V1-SCOPE-NOTIFICATIONS.md)) — awaiting manual test. **Needs a webhook URL before it does anything** — see the issue. |
| [037](037-popover-not-a-sheet.md) | The phone pop-out is a popover again, and still does not clip | Built 2026-08-06 — awaiting manual test |
| [038](038-fullscreen-before-play.md) | Fullscreen pressed before playback starts | Built 2026-08-06 — awaiting manual test. **Regression fix**, iPhone. Cannot give native fullscreen cold with the warm-up off |
| [039](039-transcript-pinned.md) | The transcript stays reachable, instead of living under the description | Built 2026-08-06, revised 2026-08-08 and 2026-08-17 — awaiting manual test |
| [040](040-this-moment-lands-at-the-top.md) | "This moment" lands the current line at the top, not the middle | Built 2026-08-06 — awaiting manual test |
| [041](041-notes-button-cursor-and-keyboard.md) | The Notes button gives you a cursor and a keyboard on the phone | Built 2026-08-06 — awaiting manual test. Reading mode may still want a second tap |
| [042](042-tidy-clears-kept.md) | A tidied note takes its hub item with it | Built 2026-08-06 — awaiting manual test |
| [043](043-desktop-full-quality.md) | Full quality on the desktop (above 360p), signed out — play the separate picture and sound files via MSE | Backlog, scoped 2026-08-17 — not built |
| [044](044-subscription-sync-recovery-and-removals.md) | Subscriptions that never came back: a wedged session, a silent one, and unsubscribes that do nothing | **Built 2026-09-02** — `lastAttemptAt` and an expired session that re-probes; the hub says when the account synced; `unsubscribedChannels` drops the channel and purges nothing. Manual test in the issue |
| [045](045-channel-screen-and-subscribe.md) | A channel screen: the back catalogue, a search inside it, and Subscribe | Scoped 2026-09-01 ([docs/V1-SCOPE-CHANNEL-SCREEN.md](../docs/V1-SCOPE-CHANNEL-SCREEN.md)) — not built. 044 is done; this needs BarkernotBob's reaction to the scope doc |
| [046](046-in-progress-chip.md) | An "In progress" list: what you started and did not finish | Scoped 2026-09-01 — not built |
| [047](047-search-blocklist-and-hide-channel.md) | A search Remove that lasts, and a way to mute a channel in search | Scoped 2026-09-01 — not built. Stage two of [docs/V1-SCOPE-CARD-CONTROLS.md](../docs/V1-SCOPE-CARD-CONTROLS.md) |
| [048](048-rss-backfill.md) | The 15-entry window loses videos permanently | Scoped 2026-09-01 — not built. Depends on 045 |
| [049](049-webclipper-template-escapes-the-description.md) | The Web Clipper template inserts a raw description and breaks the note | Scoped 2026-09-01 — not built. Small; confirm the clipper is still in use first |

## A note on how things get lost here

044 through 049 were all written on 2026-09-01 from **prose in HANDOFF.md** that
had been sitting there for weeks — decisions taken, limitations documented,
"stage two is next" — none of which had an issue file. 045 in particular was
fully specified on 2026-08-06 and bought nothing for four weeks.

A decision that is not a row in this table is not a decision, it is a paragraph.
When a session ends with "we should also…", it goes here before the handoff is
written.
