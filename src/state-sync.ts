/**
 * The protocol around `mergeStates` — when to read, when to write, and when
 * refusing to write is the only safe answer.
 *
 * Issue 014 made a save a merge, and `tests/merge.test.ts` proves the merge
 * itself is right. Issue 034 is about everything *around* it: the merge can be
 * perfect and a removal still fail to cross, because the device that should
 * receive it either never read the file, read a broken copy and wrote over it,
 * or read it correctly and never redrew the screen.
 *
 * All three decisions are pure and live here, so they can be tested with a fake
 * disk that fails on demand — which is the only way to reproduce the real
 * failure, since it needs an iCloud file to be mid-sync at the moment of a save.
 * `SubscriptionsStore` in `hub.ts` is the I/O half and holds no rules.
 */

import { mergeStates } from "./subscriptions.ts";
import type { SubscriptionsState } from "./subscriptions.ts";

/**
 * What one attempt to read the state file found.
 *
 * The distinction between the last two is the whole point. `readDisk` used to
 * answer `null` for both, and its caller could only ask "did I get a state?" —
 * so "the file is not there yet" and "the file is there and I could not read
 * it" took the same branch. They need opposite answers: the first means write,
 * the second means do not, because a file you cannot read is a file whose
 * contents you are about to destroy.
 *
 * `unreadable` is not exotic on a vault in iCloud. A `.icloud` placeholder for
 * a file that has been evicted, a partially downloaded blob, a copy caught
 * mid-replacement — all of them are a failed `read` or a `JSON.parse` throw,
 * and all of them happen precisely when the other device's decisions are in
 * flight towards this one.
 */
export type DiskRead =
  | { kind: "state"; state: SubscriptionsState }
  | { kind: "absent" }
  | { kind: "unreadable" };

/** What a save should do about what it found. */
export type SavePlan =
  | { write: true; state: SubscriptionsState; merged: boolean }
  | { write: false };

/**
 * Merge into what is on disk, or refuse.
 *
 * The refusal is the fix. Before it, a save read the file, skipped the merge
 * when the read failed, and then wrote this device's whole snapshot anyway —
 * which is issue 014's bug verbatim, reachable any time a read blipped. A
 * removal made on the phone thirty seconds ago lives only in that file, so
 * overwriting it unread is exactly how it disappears.
 *
 * Nothing is lost by refusing: the change is still in this device's memory and
 * the next save writes it. A save that does not happen costs a few seconds; a
 * save that overwrites an unread file costs whatever the other device decided.
 */
export function planSave(mine: SubscriptionsState, read: DiskRead): SavePlan {
  if (read.kind === "unreadable") return { write: false };
  // No file yet — a first run, or a vault where the plugin has never saved.
  // There is nothing to merge and nothing to lose.
  if (read.kind === "absent") return { write: true, state: mine, merged: false };
  return { write: true, state: mergeStates(mine, read.state), merged: true };
}

/** What a refresh should do about what it found. */
export interface RefreshPlan {
  /**
   * Whether this version of the file has actually been read.
   *
   * The store records the file's mtime so it can skip the read next time. It
   * used to record it *before* the read, so one failed read marked that version
   * permanently seen and the device stayed stale until something else moved the
   * file — a single blip turning into an indefinite disagreement between two
   * devices. Only a read that answered may advance the watermark.
   */
  seen: boolean;
  /** What this device should now believe. */
  state: SubscriptionsState;
  /** Whether the merge changed anything a list on screen is drawn from. */
  changed: boolean;
}

/** Fold what is on disk into what this device believes. */
export function planRefresh(mine: SubscriptionsState, read: DiskRead): RefreshPlan {
  if (read.kind === "unreadable") return { seen: false, state: mine, changed: false };
  if (read.kind === "absent") return { seen: true, state: mine, changed: false };
  const merged = mergeStates(mine, read.state);
  return { seen: true, state: merged, changed: listFingerprint(mine) !== listFingerprint(merged) };
}

/**
 * Everything a hub list draws its membership and its cards from, as one string.
 *
 * Not a deep equality: `mergeStates` rebuilds every item it reconciles, so two
 * states that mean the same thing are never the same objects and rarely the
 * same JSON — key order alone differs once `mergeItem` assigns `origin` last.
 * Comparing what the screen is actually made of answers the only question the
 * view has ("do I need to redraw?") without ever answering it wrongly for a
 * removal, which is the case that matters.
 *
 * Sorted, because file order is not a promise: `mergeStates` appends the items
 * only the other device had seen rather than sorting them in.
 */
export function listFingerprint(state: SubscriptionsState): string {
  const items = state.items
    .map((item) =>
      [
        item.videoId,
        item.state,
        item.watched ? "w" : "",
        item.isShort === true ? "s" : "",
        item.durationSeconds ?? "",
        item.notePath ? "n" : "",
      ].join(":"),
    )
    .sort()
    .join(",");
  const channels = state.channels
    .map((channel) => `${channel.id}:${channel.error ? "!" : ""}`)
    .sort()
    .join(",");
  return `${channels}|${items}`;
}

/**
 * How many times a save re-reads before it gives up on this attempt, and how
 * long it waits in between.
 *
 * The failures this is for are transient by nature — a file being replaced
 * under us takes milliseconds — so a couple of short waits turns almost all of
 * them into a normal merge. What is left is handled by not writing at all.
 */
export const SAVE_READ_ATTEMPTS = 3;
export const SAVE_READ_BACKOFF_MS = [150, 600];
