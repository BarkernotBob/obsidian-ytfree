/**
 * What you turned down in search, and it stays turned down (issue 047).
 *
 * Two lists in the state file: videos you removed from a search, and channels
 * you hid from search. Both cross devices through `mergeStates`, and both are
 * deliberately not the Hidden filter — Hidden is the drawer for hub mistakes,
 * and things you never collected must not fill it.
 *
 * Why these merge differently from the four tombstone lists already in the
 * file: both lists have an undo, in Settings, and an undo has to cross devices
 * too. `deletedVideos` gets its undo for free — the video comes back as an item
 * with a newer decision stamp, and the tombstone loses to it. Nothing comes
 * back here; a search result is never stored. So an undo is itself an entry:
 * the newest stamp per ID wins, and an entry with `undone` set is a decision to
 * show the thing again. Removing an entry outright would let the other device's
 * copy hand the block straight back on the next merge.
 */

export interface BlockEntry {
  /** A video ID or a `UC…` channel ID. */
  id: string;
  /** What the Settings list shows. Search results carry it; nothing else would. */
  title: string;
  /** When this decision was made — removal, hide, or undo. */
  at: string;
  /** True once undone. Kept so the undo outlives the other device's copy. */
  undone?: boolean;
}

/**
 * The growth bound. This file syncs through iCloud on every write, and a list
 * of every video ever declined is a cost on each of those writes. 500 entries
 * with titles is roughly 50 KB. When one falls off the end, the oldest removal
 * may reappear in a search — two years of declining something, at a few a week.
 */
export const REMOVED_VIDEOS_LIMIT = 500;
/** Channels are far fewer, and each one hides much more. */
export const HIDDEN_CHANNELS_LIMIT = 200;

/**
 * How long an undo is remembered. It only has to outlive the other device's
 * stale copy; a month covers a phone left in a drawer. After that it is noise.
 */
export const UNDO_KEEP_DAYS = 30;

/** Normalise and bound a list: newest stamp per ID, oldest first, stale undos gone. */
function settle(entries: Iterable<BlockEntry>, limit: number, now: Date): BlockEntry[] {
  const byId = new Map<string, BlockEntry>();
  for (const entry of entries) {
    const seen = byId.get(entry.id);
    if (!seen || entry.at > seen.at) byId.set(entry.id, entry);
  }
  const cutoff = new Date(now.getTime() - UNDO_KEEP_DAYS * 86_400_000).toISOString();
  return [...byId.values()]
    .filter((entry) => !entry.undone || entry.at >= cutoff)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .slice(-limit);
}

/** Record a block (or, with `blocked` false, its undo). Returns a new list. */
export function setBlocked(
  list: ReadonlyArray<BlockEntry> | undefined,
  entry: { id: string; title: string },
  blocked: boolean,
  now: Date,
  limit: number,
): BlockEntry[] {
  const next: BlockEntry = { id: entry.id, title: entry.title, at: now.toISOString() };
  if (!blocked) next.undone = true;
  return settle([...(list ?? []).filter((e) => e.id !== entry.id), next], limit, now);
}

/** Union two devices' lists. The newer decision per ID wins, undo included. */
export function mergeBlockLists(
  mine: ReadonlyArray<BlockEntry> | undefined,
  theirs: ReadonlyArray<BlockEntry> | undefined,
  limit: number,
  now: Date,
): BlockEntry[] {
  return settle([...(theirs ?? []), ...(mine ?? [])], limit, now);
}

/** The entries in force, newest first — what the Settings list shows. */
export function activeBlocks(list: ReadonlyArray<BlockEntry> | undefined): BlockEntry[] {
  return (list ?? []).filter((entry) => !entry.undone).reverse();
}

export function blockedIds(list: ReadonlyArray<BlockEntry> | undefined): Set<string> {
  return new Set(activeBlocks(list).map((entry) => entry.id));
}

/**
 * Should this result stay off the screen?
 *
 * A removed video is gone from search and from a channel screen alike. A hidden
 * channel only filters search: opening its channel screen is asking to see it.
 * And subscribing wins — a hide on a channel you now poll is ignored here even
 * before `liftHides` has caught up, which matters when the subscription arrived
 * from the other device or from the account sync.
 */
export function isResultBlocked(
  result: { videoId: string; channelId: string },
  where: "search" | "channel",
  removed: ReadonlySet<string>,
  hiddenChannels: ReadonlySet<string>,
  subscribed: ReadonlySet<string>,
): boolean {
  if (removed.has(result.videoId)) return true;
  if (where !== "search" || !result.channelId) return false;
  return hiddenChannels.has(result.channelId) && !subscribed.has(result.channelId);
}

/**
 * Subscribing to a hidden channel drops the hide. Returns the new list and the
 * hides it lifted, so the caller can say so.
 */
export function liftHides(
  list: ReadonlyArray<BlockEntry> | undefined,
  channelIds: Iterable<string>,
  now: Date,
): { list: BlockEntry[]; lifted: BlockEntry[] } {
  const hidden = new Map(activeBlocks(list).map((entry) => [entry.id, entry]));
  let next = [...(list ?? [])];
  const lifted: BlockEntry[] = [];
  for (const id of channelIds) {
    const entry = hidden.get(id);
    if (!entry) continue;
    lifted.push(entry);
    next = setBlocked(next, entry, false, now, HIDDEN_CHANNELS_LIMIT);
  }
  return { list: next, lifted };
}

export function normalizeBlockList(raw: unknown): BlockEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is BlockEntry =>
        Boolean(e) &&
        typeof e.id === "string" &&
        typeof e.at === "string" &&
        typeof (e.title ?? "") === "string",
    )
    .map((e) => {
      const entry: BlockEntry = { id: e.id, title: e.title ?? "", at: e.at };
      if (e.undone === true) entry.undone = true;
      return entry;
    });
}
