# 036 — A notification when a new video lands in the Inbox

BarkernotBob: *"I'd like an iOS notification when a new video is added to the inbox."*

Scope gate: [docs/V1-SCOPE-NOTIFICATIONS.md](../docs/V1-SCOPE-NOTIFICATIONS.md).

## What was missing

There was no way to learn that the Inbox had moved without opening the hub and
looking. A poll ran every hour on whichever device happened to be awake, filled
the Inbox, and said nothing.

The reason it had never been built is a real one: **Obsidian on iOS cannot raise
an iOS notification.** There is no plugin API for it, no background execution to
raise one from, and a plugin is not an app target so it cannot hold a push
certificate. `Notice` is an in-app toast that exists only while Obsidian is on
screen — which is exactly when you do not need telling.

So the only shape that works is the device that *polls* handing the message to
something off-device that can push. Which "something" is not a decision this
plugin should be making on BarkernotBob's behalf.

## What it does now

- **A webhook URL, and nothing more opinionated than that.** Settings →
  *New-video notifications* → **Notification webhook**. Empty by default, and
  empty means the whole feature is inert — no request is ever made. Any service
  that accepts an HTTP POST works: ntfy.sh, Pushover, an Apple Shortcuts
  automation, Home Assistant. Changing your mind later is a text field, not a
  code change. This is the same pattern as `GAME_EVENT_WEBHOOK` elsewhere.
- **One message per check, never one per video.** A poll that lands fifteen
  videos sends one POST. One video gets its title and channel; two or three get
  listed; a burst gets counted — *"12 new videos from Fireship, Veritasium,
  Acquired and 2 more."*
- **A video is announced once, ever, on any device.** Three layers, all needed:
  `mergeItems` only ever hands back videos the index has never held (so nothing
  already in the Inbox, opened, hidden or restored is a candidate); a
  `notifiedVideos` tombstone list in `subscriptions.json`, unioned by
  `mergeStates` exactly like `deletedVideos`; and the claim is made *through a
  save*, which now returns the copy that was on disk before it merged. That last
  one is what stops the Mac and the phone both pushing about the same video —
  whichever saves second sees the other's claim and stays quiet.
- **Nothing about a notification can break a poll.** `sendNotification` resolves
  on every path. A dead host, a 500, a revoked webhook: one line in the console,
  and the Inbox fills exactly as it would have.
- **A *Send test* button**, because a generic webhook gives us no way to verify
  delivery — a 2xx means the service accepted it, not that a phone lit up.
- **Message format: JSON or Text.** JSON carries the count, the channels, the
  titles and the video URLs, which is what a Shortcut or an automation wants.
  Text sends the sentence alone, for ntfy.sh — which renders the request body
  verbatim on the lock screen, so a JSON body would show up as JSON.
- **A device polling for the first time seeds silently.** A fresh install
  importing three hundred channels should not announce itself with a push about
  fifteen hundred videos it has just discovered.
- Off by default in both senses: no URL, and the send toggle off.

Verified against a local stub server, both formats, before any real endpoint
existed. Nothing in this work POSTed anywhere on the internet.

## Acceptance criteria

- [x] An empty webhook URL makes no request at all, and raises no error.
- [x] A check that adds 15 videos sends exactly one POST, not 15.
- [x] A check that adds nothing sends nothing.
- [x] A video already announced is never announced again — not on the next
      check, not after being hidden and restored, not from the other device.
- [x] A video hidden, opened or expired between the feed fetch and the save is
      not announced.
- [x] The same video arriving from two channels in one check is announced once.
- [x] Watched videos and Shorts are announced only when the Inbox is showing
      them; a video whose Shorts probe has not run yet is not treated as a Short.
- [x] The claim list survives a merge with a device that has never seen it,
      in both directions, and is capped at 500.
- [x] A state file written before this feature reads as "no claims" rather than
      crashing, and junk in the field is filtered out.
- [x] A webhook that throws, 500s or fails to resolve leaves the poll and the
      Inbox untouched, with one console line.
- [x] Only `http` and `https` URLs are accepted.
- [x] *Send test* POSTs immediately and reports success or the actual error.
- [x] Nothing in the settings pane changes size when clicked: the status line
      has a reserved height, the button has a fixed width and a label that never
      changes, and the toggle adds and removes no rows.
- [x] 459 unit tests pass; `tsc` clean; build clean.

## Manual test (for BarkernotBob)

Do **Setting this up** below first — you need a URL before any of this works.

**Proving the URL (2 minutes)**

1. Open Settings → YT Free and scroll to **New-video notifications**.
2. Paste your URL into **Notification webhook**. The line under the box should
   change from "No URL set — no messages will be sent" to "Paused — the URL is
   kept, no messages will be sent."
3. Turn **Send notifications** on. The line should now read "Ready."
4. Press **Send test**. Within a second or two the line should say "Sent", and
   your phone should show a notification. If the line says *Failed* it will
   quote the actual error — that is the URL being wrong, not a mystery.
5. Deliberately break it: change the URL to `https://example.invalid/nope` and
   press **Send test** again. It should say *Failed* with a network error, and
   nothing else in the pane should move or go red. Put your real URL back.

**Proving it doesn't reflow (30 seconds)**

6. Watch the rows *below* the status line while you press **Send test**. Nothing
   underneath should shift up or down as the message changes length — the line
   is two lines tall whether it says four words or twenty.
7. Flip **Send notifications** off and on. No row should appear or disappear.

**Proving the real thing (this one takes a day)**

8. Leave the Mac running with Obsidian open. Don't open the hub.
9. Next time one of your channels publishes, you should get **one**
   notification, on your phone, naming the video and the channel.
10. Open the hub. The video should be in the Inbox.
11. Wait for the next hourly check — or run *YT Free: Check subscriptions for
    new videos* from the command palette. **You must not be notified about that
    video a second time.** This is the test that matters.
12. Hide the video, then put it back from the **Hidden** list. Run the check
    again. Still no second notification.

**Proving two devices don't double up**

13. With the Mac still running, open Obsidian on the **iPhone** and let it check
    (or run the same command there).
14. When a new video next lands you should get **one** notification, not two —
    whichever device gets there first sends it, and the other sees the claim in
    the synced state file and stays quiet.
15. If you ever do get two for the same video, say so and say roughly how far
    apart they arrived. That is the read-write race documented in the scope
    file, and the size of the gap tells us whether it is worth closing.

**Proving a burst is one buzz**

16. If you ever come back from a few days away and a check finds a dozen videos
    at once, you should get **one** notification that counts them and names the
    channels — not a dozen.

## Setting this up (for BarkernotBob)

You need a URL. Two cheap ways, no code either way.

### Option A — ntfy.sh (no account, about 3 minutes)

1. Pick a **topic name that nobody could guess**. Not `my-youtube`. Something
   like `ytfree-k7m2q9xv4bz1nrt8`. Generate one in Terminal if you like:
   `openssl rand -hex 12`.
2. On the iPhone, install **ntfy** from the App Store
   (https://apps.apple.com/app/ntfy/id1625396347).
3. Open it, tap **+**, leave the server as `ntfy.sh`, and enter your topic name
   exactly. Allow notifications when iOS asks.
4. In Obsidian: Settings → YT Free → **New-video notifications**.
   - **Notification webhook**: `https://ntfy.sh/ytfree-k7m2q9xv4bz1nrt8`
     (your topic, not that one).
   - **Message format**: **Text**. ntfy shows whatever you POST as the
     notification body, so JSON would arrive looking like JSON.
   - **Send notifications**: on.
5. Press **Send test**.

**Read this before you use ntfy.sh:** the public ntfy.sh server has no
authentication. **Anyone who knows or guesses your topic name can read every
notification you send to it**, and can send notifications to it themselves.
Nothing secret goes through here — it is video titles and channel names — but
that is the trade, and it is why the topic name has to be random rather than
memorable. (ntfy Pro adds access control, and ntfy can be self-hosted, if this
ever matters more than it does today.)

### Option B — Apple Shortcuts (no third party, about 5 minutes)

Keeps everything between your own devices. Slightly more fiddling, and the
webhook URL it produces is a secret in the same way.

1. On the iPhone, open **Shortcuts** → **Automation** tab → **+**.
2. Choose **When I get a webhook** (iOS 18.4 and later; on an older iOS use
   Option A).
3. Give the automation a name — this is what forms the URL.
4. Add one action: **Show Notification**. For the text, use the **Shortcut
   Input** variable so the message from YT Free is what you see.
5. Tap **Done**, then copy the webhook URL Shortcuts shows you.
6. In Obsidian, paste it into **Notification webhook** and leave **Message
   format** on **JSON** — a Shortcut can pull `message`, `count` and `videos`
   out of it if you want to get fancier later. Turn **Send notifications** on
   and press **Send test**.

### Either way

- **Off is the default.** Until you paste a URL and turn the toggle on, this
  plugin makes no outbound requests of any kind.
- **The URL is a secret.** It lives in `data.json` in the vault, which syncs
  through iCloud — the same place the session file deliberately does *not* live.
  Anyone with the URL can push notifications to your phone.
- **A failure is silent.** If the service is down you miss one push; you do not
  get a duplicate later, and the video is still in the Inbox where it belongs.
