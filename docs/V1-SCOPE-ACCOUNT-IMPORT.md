# v1 scope — Sign in to YouTube, import account data

Issue 006. Written 2026-07-27. **Approved 2026-07-28. Gate spiked and passed.
Not built.**

**One sentence:** a Sign in button opens a YouTube login window inside Obsidian,
and from then on the hub knows what you subscribe to, what is in your Watch
Later, and what you have already watched — while playback stays anonymous, so
nothing you watch in Obsidian is ever attributed to your account.

**Smallest version a stranger gets value from:** click Sign in, sign in, and the
subscriptions hub fills itself from your real account instead of a Takeout CSV.

## The finding that shaped this

The obvious design — Google OAuth and the YouTube Data API — cannot do the job.

`contentDetails.relatedPlaylists.watchHistory` and `.watchLater` were deprecated
on 11 August 2016, and since 12 September 2016 they return the literal strings
`HL` and `WL` for every channel. The system-managed playlists behind those IDs
reject item listing even for the account that owns them. The Data API gives
subscriptions cleanly and gives neither of the other two at all.

So the choice is not "clean OAuth vs. grubby cookies." It is "subscriptions
only, via OAuth" or "all three, via cookies." This scope takes the second.

## Verified foundations (tested 2026-07-27, before any code)

| Fact | Evidence |
|---|---|
| yt-dlp can read all three lists | `--list-extractors` shows `youtube:subscriptions`, `youtube:watchlater`, `youtube:history`, `youtube:favorites` |
| All three require authentication | `yt-dlp :ytsubs` → "Login details are needed… Use --cookies-from-browser or --cookies" |
| Watch Later is not anonymously reachable | `yt-dlp :ytwatchlater` → `HTTP Error 404: Not Found` |
| Arc is not a supported cookie source | yt-dlp's browser list is brave, chrome, chromium, edge, firefox, opera, safari, vivaldi, whale |
| The Data API cannot serve WL or history | Google's own revision history, 11 Aug 2016 deprecation |
| Playback already sends no account cookies | `resolveStream` → signed googlevideo URL, played by `<video>`/hls.js. IP-locked, not account-linked |

## The gate — spiked 2026-07-28, and it is clear

Approved and spiked on `prototype/signin-spike`. The finding reverses the
approach this document originally assumed.

| Variant | Result |
|---|---|
| `BrowserWindow`, UA spoofed to Chrome 142, at `accounts.google.com/ServiceLogin` | **Blocked** — "couldn't sign you in / this browser or app may not be secure" |
| `<webview>` tag in a Modal, **user agent untouched**, at `youtube.com` | **Signed in, first try** |

Three rules for the build fall out of it:

1. **Do not spoof the user agent.** It is the one change that demonstrably
   produced a block. Electron's `Sec-CH-UA` client hints name Electron and omit
   the high-entropy hints real Chrome sends (electron#34762), so a Chrome UA
   string over those headers is a visible mismatch; the untouched default is at
   least self-consistent. Media Extended — the existence proof that this works —
   sets no user agent anywhere in its login path.
2. **Do not add client-hint rewriting.** It was built and never needed. It only
   exists to paper over a spoof we are not doing.
3. **Use a `<webview>` in a Modal, and point it at `youtube.com`** — not a
   `BrowserWindow`, and not at a sign-in URL. `ServiceLogin` is the endpoint
   with the embedded-browser check bolted to it; the avatar menu on youtube.com
   never goes near it. Two variables differed between the blocked run and the
   passing one, so this is the safe reading rather than an isolated cause.

Still unverified, and now the first thing the build must do: whether the session
cookies can be read back out of the partition and whether **yt-dlp accepts
them** for `:ytsubs`. The spike came down before those commands ran. Cheap to
answer now that sign-in is solved, and if it fails the rest of this scope is
dead — so it goes first, before any UI.

## The split, which is the whole point

| Path | Cookies attached? | Frequency |
|---|---|---|
| Account data — subscriptions, Watch Later, history | **Yes** | Scheduled, default every 12h |
| Channel RSS polling | No | Hourly (unchanged) |
| Stream resolution and playback | **No** | Every video |
| Transcript, most-replayed, downloads | No | On demand |

Watching a video in Obsidian therefore adds nothing to your YouTube history and
is not attributed to your account. History flows **in only** — what you watched
on your phone or TV, so the hub can mark it as already seen.

## In scope for v1

### 1. Sign in
- **Sign in to YouTube** button in settings, and a command.
- Opens a `<webview>` in a modal on `youtube.com`, with its own persistent
  session partition and **the user agent left alone** — see the gate section
  above for why both of those are load-bearing. You sign in from YouTube's own
  avatar menu, typing into Google's own page. The plugin does not read, log,
  intercept or store the password — it waits for the view to land on a signed-in
  YouTube page and then reads the session cookies out of the partition.
- Cookies are written in Netscape format to a file **outside the vault**,
  defaulting beside the download folder (`~/Library/Application Support/…`),
  mode `600`.
- **Sign out** deletes that file and clears the partition.
- Settings shows one of three states, in reserved space so it never reflows:
  *Not signed in* · *Signed in as <name>* · *Session expired — sign in again*.

### 2. Import subscriptions from the account
- Replaces the Takeout CSV as the recommended path. The CSV import stays, and
  stays the documented fallback for when sign-in breaks.
- `yt-dlp --flat-playlist :ytsubs` → channel IDs and titles → the existing
  `addChannels`, which is already additive and idempotent.
- Unsubscribing on YouTube still does not remove a channel from the hub. That
  rule does not change just because the source did.

### 3. Watch Later
- `yt-dlp --flat-playlist :ytwatchlater` → items merged into the hub as normal
  entries, marked with their origin so they are distinguishable from feed items.
- Note that WL items arrive **without a description** in flat mode. They get one
  if and when the channel's RSS feed also carries them; otherwise the note's
  Description section says so rather than sitting silently empty.

### 4. Watch history → a Watched marker
- `yt-dlp --flat-playlist --playlist-end N :ythistory` on the same schedule.
- Any hub item whose video ID appears in history is marked **Watched** and, by
  default, hidden from the New filter. One setting to show them.
- History is read-only and one-directional. Nothing in this plugin ever writes
  to your YouTube history, which is the entire reason playback stays anonymous.
- Bounded to the most recent N entries (default 200). The full history is
  enormous and almost all of it is irrelevant to a 30-day hub.

### 5. Scheduling and exposure
- One authenticated cycle covers all three lists, default every **12 hours**,
  configurable 1–48h, plus an on-demand **Sync account now** command.
- Authenticated calls are serialized and never run concurrently with each other.
- A failed authenticated call marks the session expired and **stops retrying**
  until you sign in again. Hammering an expired session is exactly the pattern
  that gets an account flagged.

## Explicitly NOT v1 (→ v2 tickets)

- Playing members-only or age-restricted videos. That needs cookies on the
  playback path, which is the one thing this design refuses to do.
- Writing anything to YouTube: subscribing, adding to WL, marking watched.
- Liked videos (`:ytfav`) and recommendations (`:ytrec`).
- OAuth / Data API as a second, parallel auth mechanism for subscriptions.
- Sharing a session between the two Macs. Sign in on each.
- Mobile. Same reason as the rest of the project.

## Known hard limitations, and the risks (accept, or do not build)

- **Google blocks sign-in from embedded browsers, and we are inside one.** The
  spike found a shape it does not block, not an exemption. Google changes this
  detection, and when it changes, sign-in breaks — which is why the Takeout CSV
  import stays and stays documented.
- **A session cookie is not a scoped token.** Unlike OAuth, what gets stored is
  full, unscoped access to the Google account: anyone who obtains that file can
  act as you across every Google property until you sign out. This is why it
  must never live in the vault — iCloud would sync your live Google session to
  both Macs and to Apple's servers.
- **Recurring authenticated requests are the documented account-flagging risk.**
  yt-dlp's own documentation warns that account cookies can get an account
  flagged or banned. Pulling history on a schedule means this runs forever, not
  once. The 12-hour default and the stop-on-expiry rule are the mitigations;
  they reduce exposure and do not eliminate it. **BarkernotBob has been told this
  twice and has chosen to proceed. Recorded here so the decision is not
  rediscovered later as a bug.**
- **Reading cookies out of a live session can invalidate it**, signing you out
  of YouTube in that window. The dedicated partition is what keeps this away
  from your normal browsing.
- Sessions expire. Expect to sign in again periodically; the UI says so plainly
  rather than failing silently.

## Acceptance criteria

1. Clicking Sign in opens a YouTube login window; after signing in, settings
   reports *Signed in as <name>* without Obsidian being restarted.
2. The password is never read, logged or written by plugin code — verifiable by
   grep and by the absence of any input handler on that window.
3. The cookie file exists outside the vault, is mode `600`, and a vault-wide
   search finds no Google session token anywhere inside the vault.
4. **Importing subscriptions from the account produces the same channel list a
   Takeout CSV produces**, and re-running it adds nothing.
5. Watch Later items appear in the hub and can be clicked into notes.
6. A video watched on another device is marked Watched in the hub within one
   sync cycle, and is hidden from New by default.
7. **Playing a video in Obsidian does not appear in YouTube history**, checked on
   youtube.com afterwards. This is the criterion the whole design exists for.
8. Signing out deletes the cookie file, and the next sync reports expired rather
   than erroring repeatedly.
9. An expired session stops retrying and says so; it does not retry in a loop.
10. With sign-in broken or never used, everything built before this still works:
    the hub still polls RSS, notes still open, playback is unaffected.

## Manual test (for BarkernotBob)
To be written when v1 is complete, per the backlog rule.
