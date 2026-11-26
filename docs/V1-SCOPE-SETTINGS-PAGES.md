# V1 scope: settings pages and README cleanup

Isaiah, 2026-11-26: "Making the plugin description and setup steps more accurate and simple ...
we didn't do any work to make the settings clean." Approved shape: native sub-pages on
Obsidian 1.13+, the old flat list before it. Mockup: https://claude.ai/artifact/P7ZbnBZCNmah8TAi7JPk3A

## In

- Settings → YouTube for You shows seven rows, each opening its own page: Playback, Notes,
  Transcripts, Subscriptions, Alerts, Links, Advanced. Every row stays in Obsidian's settings search.
- Obsidian older than 1.13: the same rows in one list, a heading per page, Advanced folded.
- Plain labels and one-to-two-sentence descriptions. Renames:

  | Was | Now |
  |---|---|
  | Upgrade to high quality / HD on this phone (experimental) | HD video |
  | Start in HD | Wait for HD |
  | Compress pauses | Skip pauses |
  | Resume after | Play again after |
  | Lookback | Rewind timestamps by |
  | Link timestamps in the note body | Make times clickable |
  | Pin the player to the top of the note | Pin the player |
  | Pinned player height | Player height |
  | Collapse properties on video notes | Fold properties |
  | Collapse description and transcript | Fold description and transcript |
  | New-note folder | Folder for new notes |
  | Tidy empty notes after | Clean up empty notes after |
  | Fetch automatically for new notes | Add to new notes |
  | Caption language | Language |
  | Section length | Paragraph length |
  | Follow the video | Follow along |
  | Import subscriptions | Import from YouTube |
  | Check every | Check for new videos every |
  | Forget unwatched videos after | Remove unwatched videos after |
  | Hidden from search | Hidden channels |
  | Notification webhook / Send notifications / Message format / Send a test notification | Alert address / Send alerts / Format / Test it |
  | Frontmatter properties | Video link properties |
  | Word protection | Word guard |
  | Get the video ready when a note opens | Get video ready on open |
  | Log what the player is doing | Debug log |

  Old names are search aliases where people would look for them (Lookback, Smart Speed, webhook…).
- Removed: the text-only "On this device" row; dead stored settings (yt-dlp path, ffmpeg path,
  download folder, two ffmpeg loudness dials).
- Destructive buttons use `setDestructive` where it exists.
- README rewritten: what you get, a 3-step quick start, getting videos in, settings, devices,
  network and privacy (disclosures kept), limitations. `docs/DESKTOP-HELPERS.md` moved to
  `docs/archive/`.

## Out

- The store description (own thread). Tabs (no native support). Requiring Obsidian 1.13.
- The main UI polish (Isaiah's priority 2).

## Manual test

1. Phone: Settings → YouTube for You. Expect seven rows with one-line summaries.
2. Tap **Playback**. Expect Quality, Skip pauses and While you type groups; the back arrow returns.
3. Toggle **HD video** off, leave and reopen. Expect it still off. Turn it back on.
4. In the settings search box type `lookback`. Expect **Rewind timestamps by**.
5. **Subscriptions → Hidden channels → Manage…**, close it. Expect the count line to match.
6. **Subscriptions → Clear watch history → Clear…**. Expect a red button in the dialog; press Cancel.
7. **Alerts → Alert address**: type `x`. Expect the line under it to say it does not look like an http or https URL.
8. Mac: repeat 1, 2 and 4. **Advanced** has no "Get video ready on open" row on the Mac.
