# V1 scope: a link that opens the subscriptions hub

Asked 2026-10-21: a link an iPhone Shortcut can open that lands directly on the
subscriptions hub.

## Today

`obsidian://ytfree` exists (GitHub #3) but only takes `url=` for a video. With
no `url` it shows "that is not a link to a YouTube video." There is no link to
the hub. `obsidian://advanced-uri?commandid=ytfree:open-subscriptions-hub`
would work, but only with the Advanced URI community plugin installed.

## v1

- `obsidian://ytfree?view=subscriptions` opens the hub (reuses the open tab,
  exactly like the ribbon icon and the "Open subscriptions hub" command).
- `obsidian://ytfree?view=search` opens the hub's search screen.
- `obsidian://ytfree` with nothing else also opens the hub, instead of the
  error notice.
- `url=` keeps working and wins if both are given.
- An unknown `view` value shows a notice naming the ones that exist.
- With several vaults, add `&vault=<name>` (Obsidian's own parameter).

## Not in v1

- Deep links to a channel screen or a section of the hub.
- A "copy hub link" button in settings.

## Manual test (iPhone)

1. Shortcuts → + → Add Action → "Open URLs". URL: `obsidian://ytfree?view=subscriptions`.
2. Close Obsidian fully, run the shortcut: Obsidian opens on the hub.
3. Open a note, run it again: the existing hub tab comes forward, no second tab.
4. `obsidian://ytfree?view=search` opens the search screen.
5. `obsidian://ytfree?view=nope` shows a notice listing `subscriptions` and `search`.
