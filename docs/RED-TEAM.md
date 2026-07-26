# Red-team: should obsidian-ytfree exist?

Gate required before build. Written 2026-07-26.

## The 3 closest existing products

### 1. Media Extended (aidenlx) — the real competitor
939 stars, actively maintained, the default answer for video notes in Obsidian.

**Does:** timestamped links, screenshot capture with timestamp backlink, interactive
`.srt`/`.vtt` transcripts, pinnable player, media fragments (`#t=`), YouTube/Vimeo/Coursera.

**Does not:** ad-free playback, alternative frontends, yt-dlp, direct stream resolution.
It embeds YouTube's own player, so it inherits YouTube's ads wholesale.

**Why users stay:** it's mature, it's in the community store, and its transcript +
screenshot features are genuinely deep. v4 is going closed source, which is a mark
against it long-term but not today.

### 2. uBlock Origin / ad blockers
**Why users stay:** zero setup, works everywhere, not just Obsidian.
**Why it doesn't solve this:** doesn't apply inside Obsidian's Electron webview, and
YouTube's server-side ad insertion is actively defeating request-blocking anyway.

### 3. YouTube Premium
**Why users stay:** it works, permanently, sanctioned, no maintenance.
**Why it doesn't solve this:** costs money, and does nothing for note-taking workflow.

## The one reason this wins

Media Extended cannot play an ad-free stream, and no ad blocker can strip SSAI.
The union — *ad-free stream* **plus** *note-native timestamps* — does not exist today.
This plugin is the only thing in the list that resolves the video outside YouTube's
player, so ads are never in the byte stream to begin with.

## The case against building (steelman)

1. **Media Extended already covers ~80% of the "amazing" feature list.** Timestamps,
   screenshots, transcripts, pinned player. Rebuilding those is duplicated effort.
2. **This is a maintenance treadmill.** yt-dlp needs frequent updating; YouTube
   actively breaks extraction. Media Extended's YouTube-player approach never breaks
   this way.
3. **ToS.** Against YouTube's terms. Personal/local use only. Not shippable to the
   community store, so this is permanently a private plugin.
4. **Desktop-only.** yt-dlp is a binary shelled out via Node — Obsidian mobile has no
   Node, so the mobile app gets nothing. Conflicts with the global "mobile-first"
   requirement, which simply cannot apply here.

## Verdict: build — but the scope is narrower than it looks

Counter to objection 1, which is the only serious one: rebuilding the player features
is *cheap*, not duplicated effort. A native `<video controls>` element gives full
transport controls **and** Picture-in-Picture **for free** from the browser — zero code.
Timestamp insertion against a `<video>` element is `Math.floor(video.currentTime)`,
roughly 50 lines. The expensive Media Extended features (transcripts, screenshot
cropping) are explicitly **not** in v1.

So the build is: stream resolution + refresh + a thin player shell. Not a
Media-Extended clone.

Objections 2–4 are accepted as real costs, not refuted:
- Treadmill: accepted. Mitigation is a version check and a clear error, not a fix.
- ToS: accepted. Private repo, never published.
- Desktop-only: accepted and documented as a hard limitation.

If yt-dlp extraction breaks for more than ~2 weeks at a stretch, revisit — that is the
kill signal for this project.
