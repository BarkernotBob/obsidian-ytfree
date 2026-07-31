/**
 * The subscriptions hub: the state file, the poller, and the view.
 *
 * Everything here needs Obsidian or the network. The rules it applies — what
 * merges, what expires, what a note looks like — live in `subscriptions.ts` and
 * are tested there.
 */

import {
  App,
  ButtonComponent,
  ItemView,
  Modal,
  MarkdownView,
  Notice,
  Platform,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  requestUrl,
  setIcon,
} from "obsidian";
import { YT_ICON } from "./icon";
import type { HubFilter, HubItem, SubscriptionsState } from "./subscriptions";
import {
  buildWatchLaterNote,
  deskSub,
  emptyState,
  extractChannelIdFromHtml,
  forgetVideo,
  hideItem,
  keepItem,
  mergeStates,
  parseChannelInput,
  parseSubscriptionsCsv,
  expireItems,
  feedUrl,
  noteFeedFailure,
  noteFeedSuccess,
  withRetries,
  FEED_ATTEMPTS,
  FEED_BACKOFF_MS,
  formatDuration,
  formatViews,
  mergeItems,
  normalizeState,
  parseChannelFeed,
  phoneSubParts,
  relativeAge,
  rememberVideo,
  restoreItem,
  sanitizeFileName,
  searchResultToItem,
  visibleItems,
} from "./subscriptions";
import { NOTES_HEADING } from "./sections";
import { hubSlots, searchSlots, shownCount, watchedFraction } from "./cards";
import type { CardActionKey, CardFacts, CardSlot } from "./cards";
import { fetchTranscriptCues, fetchVideoDetails, searchYouTube } from "./innertube";
import type { Cue } from "./transcript";
import type { SearchPage, SearchResult } from "./search";
import {
  DURATION_OPTIONS,
  FEATURE_OPTIONS,
  SORT_OPTIONS,
  UPLOAD_DATE_OPTIONS,
  defaultFilters,
  isDefaultFilters,
} from "./search-params";
import type { SearchFilters } from "./search-params";

export const HUB_VIEW_TYPE = "ytfree-hub";

/**
 * How the hub asks for a player without knowing what one is.
 *
 * The whole engine lives in the plugin — stream resolution, recovery, Smart
 * Speed, the progress store — and the hub's business is cards and lists. This
 * one function is the entire seam between them: give me a player for this video
 * in this box, and give me back the way to stop it.
 */
export type PreviewMount = (
  host: HTMLElement,
  videoId: string,
) => Promise<PreviewHandle>;

/**
 * What the hub is allowed to do with the player it asked for.
 *
 * `destroy` is the contract that matters — nothing else will tear a preview
 * down. `seek` and `currentTime` exist for the transcript beside it: a line is
 * a place to jump to, and the line being spoken has to be the one lit up.
 */
export interface PreviewHandle {
  destroy: () => void;
  seek: (seconds: number) => void;
  currentTime: () => number;
}

/**
 * Offer the two ways to share a video, against the control that was pressed.
 *
 * The same seam the player bar uses, so Preview's Share and the Share on a
 * playing note's control bar are one behaviour with two buttons rather than
 * two behaviours that have to be kept saying the same thing.
 */
export type ShareMenu = (anchor: HTMLElement, videoId: string, seconds: number) => void;

export interface HubSettings {
  pollMinutes: number;
  expiryDays: number;
  includeShorts: boolean;
  watchLaterFolder: string;
  /** Keep videos the account says were already watched in the Inbox. */
  showWatched: boolean;
  /** Which captions Preview asks for — the same setting the note fetch uses. */
  transcriptLanguage: string;
}

/**
 * How many durations one poll will go and fetch.
 *
 * A channel feed states no duration, so every feed item needs a player call to
 * learn one — and a fresh import is hundreds of items. Capped rather than
 * batched into oblivion: the newest items are done first, a poll costs a
 * bounded number of requests, and a backlog fills itself in over the next few
 * polls without anyone waiting for it. A card with no duration yet is a card
 * with an empty badge, which is a reserved box either way.
 */
const DURATION_BACKFILL_PER_POLL = 40;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Run `worker` over `items`, at most `limit` in flight. */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await worker(next);
    }
  });
  await Promise.all(runners);
}

export class SubscriptionsStore {
  state: SubscriptionsState = emptyState();
  polling = false;
  /** Bumped on every change so open views can redraw without being told what. */
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();
  /** mtime of the last state file we read or wrote — see `refreshFromDisk`. */
  private diskTime = 0;

  constructor(
    private app: App,
    private statePath: string,
    private settings: () => HubSettings,
  ) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async load(): Promise<void> {
    const disk = await this.readDisk();
    if (disk) this.state = disk;
    await this.noteDiskTime();
  }

  /** What is in the file this instant, or null if there is nothing readable. */
  private async readDisk(): Promise<SubscriptionsState | null> {
    try {
      if (!(await this.app.vault.adapter.exists(this.statePath))) return null;
      return normalizeState(JSON.parse(await this.app.vault.adapter.read(this.statePath)));
    } catch (err) {
      // Starting empty is right at load and wrong at save — a half-synced file
      // must never be treated as "the other device decided nothing".
      console.error("YT Free: subscriptions state unreadable.", err);
      return null;
    }
  }

  private async noteDiskTime(): Promise<void> {
    this.diskTime = (await this.app.vault.adapter.stat(this.statePath))?.mtime ?? 0;
  }

  /**
   * Write the state — by merging into what is on disk, never by replacing it.
   *
   * The file is synced by iCloud and both devices hold it open, so a plain
   * write means the last device to save wins the entire file. That is how
   * videos hidden on the phone came back: the Mac's poll rewrote the file from
   * the snapshot it loaded hours earlier. Re-reading here costs one file read
   * per save and makes the file the union of both devices' decisions instead.
   *
   * Serialized: a poll and a click can both finish inside the same tick, and
   * two merges must not interleave with each other's reads.
   */
  save(): Promise<void> {
    this.saving = this.saving
      .then(async () => {
        const disk = await this.readDisk();
        if (disk) this.state = mergeStates(this.state, disk);
        await this.app.vault.adapter.write(this.statePath, JSON.stringify(this.state));
        await this.noteDiskTime();
        if (disk) this.emit();
      })
      .catch((err) => console.error("YT Free: could not write subscriptions state.", err));
    return this.saving;
  }

  /**
   * Pick up decisions made on the other device, without waiting for a save.
   *
   * A stat, and a read only when the file has actually moved — cheap enough to
   * call on every hub open and every poll tick. Without it a Mac left open all
   * day would keep showing videos the phone hid hours ago, and would keep
   * merging against a copy of the file that gets staler by the hour.
   */
  async refreshFromDisk(): Promise<void> {
    let mtime: number;
    try {
      mtime = (await this.app.vault.adapter.stat(this.statePath))?.mtime ?? 0;
    } catch {
      return;
    }
    if (mtime === this.diskTime) return;
    this.diskTime = mtime;

    const disk = await this.readDisk();
    if (!disk) return;
    this.state = mergeStates(this.state, disk);
    this.emit();
  }

  // ------------------------------------------------------------- channels

  addChannels(incoming: Array<{ id: string; title: string }>): number {
    const before = this.state.channels.length;
    const byId = new Map(this.state.channels.map((c) => [c.id, c]));
    for (const channel of incoming) {
      if (byId.has(channel.id)) continue;
      byId.set(channel.id, {
        id: channel.id,
        title: channel.title,
        addedAt: new Date().toISOString(),
        error: null,
      });
    }
    this.state.channels = [...byId.values()];
    this.emit();
    void this.save();
    return this.state.channels.length - before;
  }

  /**
   * Forget a channel and everything of its we have not kept. Notes already made
   * from it stay — the plugin never deletes a file.
   */
  removeChannel(channelId: string): void {
    this.state.channels = this.state.channels.filter((c) => c.id !== channelId);
    this.state.items = this.state.items.filter(
      (item) => item.channelId !== channelId || item.state === "kept",
    );
    // A tombstone, for the same reason a hidden video gets one: without it the
    // other device's copy hands the channel and its videos straight back on the
    // next merge.
    this.state.removedChannels = [
      ...(this.state.removedChannels ?? []).filter((r) => r.id !== channelId),
      { id: channelId, at: new Date().toISOString() },
    ];
    this.emit();
    void this.save();
  }

  // ----------------------------------------------------------------- poll

  async poll(): Promise<void> {
    if (this.polling) return;
    // Before anything: a poll ends in a save, and a save built on a stale copy
    // of the file is what used to undo the other device's decisions.
    await this.refreshFromDisk();
    if (this.state.channels.length === 0) return;
    this.polling = true;
    this.emit();

    const now = new Date();
    try {
      await mapLimit(this.state.channels, 5, async (channel) => {
        try {
          // Retried, because the endpoint fails at random — see FEED_ATTEMPTS.
          const response = await withRetries(
            () => requestUrl({ url: feedUrl(channel.id), throw: true }),
            FEED_ATTEMPTS,
            FEED_BACKOFF_MS,
            sleep,
          );
          const feed = parseChannelFeed(response.text);
          // The feed's own title is authoritative; a Takeout export goes stale.
          if (feed.channelTitle) channel.title = feed.channelTitle;
          noteFeedSuccess(channel);
          const merged = mergeItems(
            this.state.items,
            channel,
            feed.entries,
            now,
            this.state.deletedVideos ?? [],
          );
          this.state.items = merged.items;
        } catch (err) {
          // Counted, and shown only after several polls running have failed. A
          // channel that is genuinely gone still surfaces; a bad afternoon at
          // Google no longer paints half the list red.
          noteFeedFailure(channel, err instanceof Error ? err.message : String(err));
        }
      });

      // Expire before probing: on a fresh import this is the difference between
      // a few dozen probes and fifteen hundred.
      const expired = expireItems(this.state.items, this.settings().expiryDays, now);
      this.state.items = expired.items;

      // Telling a Short from a long-form video means reading a redirect status,
      // which needs Node's `https` — so it only happens on desktop, and it is
      // imported dynamically because that import throws at module load on iOS.
      // Mobile leaves `isShort` null, which already means "ask again later";
      // the next desktop poll fills it in and nothing is misclassified.
      if (Platform.isDesktopApp) {
        const { probeIsShort } = await import("./desktop/shorts-probe.ts");
        const unprobed = this.state.items.filter((item) => item.isShort === null);
        await mapLimit(unprobed, 5, async (item) => {
          item.isShort = await probeIsShort(item.videoId);
        });
      }

      await this.backfillDurations();

      this.state.lastPolledAt = now.toISOString();
    } finally {
      this.polling = false;
      this.emit();
      await this.save();
    }
  }

  /**
   * Learn how long the videos are, a bounded number of them at a time.
   *
   * Unlike the Shorts probe this runs on the phone too, because it has to: the
   * card that shows a duration is the phone's card, and a phone that only ever
   * read durations written by a Mac would show none at all on a video it added
   * itself. It is the same player call the plugin already makes to play
   * anything, so it is not a new kind of cost — only a bounded amount of it.
   *
   * Newest first, and hidden items never: a tombstone is a line of text with no
   * thumbnail to put a badge on. A refusal is recorded as `null` so a private
   * or deleted video is asked once rather than on every poll forever.
   */
  private async backfillDurations(): Promise<void> {
    const pending = this.state.items
      .filter((item) => item.state !== "dismissed" && item.durationSeconds === undefined)
      .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0))
      .slice(0, DURATION_BACKFILL_PER_POLL);
    if (pending.length === 0) return;

    await mapLimit(pending, 4, async (item) => {
      const details = await fetchVideoDetails(item.videoId);
      // Re-looked-up after the round trip: a click elsewhere can save — and so
      // merge — while these are in flight. See `live`.
      const target = this.live(item);
      if (target.state === "dismissed") return;
      target.durationSeconds = details.durationSeconds;
      // Free, and it is the thing the hub exists to hold on to: a Watch Later
      // item arrives without one, and a feed item whose video has since fallen
      // out of the 15-entry window can never get one anywhere else.
      if (!target.description && details.description) target.description = details.description;
    });
  }

  // --------------------------------------------------------------- search

  hasItem(videoId: string): boolean {
    return this.state.items.some((item) => item.videoId === videoId);
  }

  /** The hub's own copy of this video, if it has one. */
  itemFor(videoId: string): HubItem | null {
    return this.state.items.find((item) => item.videoId === videoId) ?? null;
  }

  /** The video whose note lives at this path, if the hub made one. */
  videoIdForNotePath(path: string): string | null {
    return this.state.items.find((item) => item.notePath === path)?.videoId ?? null;
  }

  /** A note for this video exists — which is what Kept means. */
  hasNote(videoId: string): boolean {
    const item = this.itemFor(videoId);
    return Boolean(item?.notePath);
  }

  /**
   * Add a search result to the hub. Adds — it does not open, does not create a
   * note and does not play anything. Browse adds; the hub decides.
   *
   * The description is fetched here, one player call, because search carries
   * none and the hub's premise is that the description is cached before it can
   * go stale. `fetchDescription` answers "" rather than throwing, so a video
   * that is private or gone still lands as an item.
   */
  async addSearchResult(result: SearchResult): Promise<"added" | "exists"> {
    if (this.hasItem(result.videoId)) return "exists";
    const details = await fetchVideoDetails(result.videoId);
    // Checked again: the fetch is a round trip, and a poll or a second click
    // can land inside it. Never a duplicate.
    if (this.hasItem(result.videoId)) return "exists";
    rememberVideo(this.state, result.videoId);
    this.state.items.push(
      searchResultToItem(result, details.description, new Date(), details.durationSeconds),
    );
    this.emit();
    void this.save();
    return "added";
  }

  // ----------------------------------------------------------------- note

  /**
   * Turn an item into a Watch Later note. Creates it; does not open it.
   *
   * This is the half of the old `openItem` that Save needs. Splitting it is
   * what lets a card offer "make the note" and "make the note and go there" as
   * two buttons without a fourth item state: Kept still means exactly what it
   * meant — a note exists.
   *
   * Answers the file either way, and says whether this call is the one that
   * made it, because a brand new note is the only one whose cursor should be
   * moved. Nothing here ever overwrites a file.
   */
  async createNote(item: HubItem): Promise<{ file: TFile; created: boolean } | null> {
    const existing = item.notePath
      ? this.app.vault.getAbstractFileByPath(item.notePath)
      : null;
    if (existing instanceof TFile) return { file: existing, created: false };

    const folder = this.settings().watchLaterFolder.replace(/^\/+|\/+$/g, "");
    if (folder && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
      try {
        await this.app.vault.createFolder(folder);
      } catch {
        // Already there, or the name is taken by a file — createFile says so.
      }
    }

    const base = sanitizeFileName(item.title) || item.videoId;
    let path = folder ? `${folder}/${base}.md` : `${base}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);

    // A name collision is almost always the same video clipped by hand earlier,
    // in which case that note is the one to open. Two different videos sharing a
    // title get the ID appended rather than one of them being lost.
    if (file instanceof TFile) {
      const content = await this.app.vault.cachedRead(file);
      if (!content.includes(item.videoId)) {
        path = folder
          ? `${folder}/${base} [${item.videoId}].md`
          : `${base} [${item.videoId}].md`;
        file = this.app.vault.getAbstractFileByPath(path);
      }
    }

    let created = false;
    if (!(file instanceof TFile)) {
      file = await this.app.vault.create(path, buildWatchLaterNote(item, new Date()));
      created = true;
    }

    keepItem(this.live(item), path, new Date());
    this.emit();
    void this.save();

    return file instanceof TFile ? { file, created } : null;
  }

  /**
   * Make the note and leave it alone — the Save button.
   *
   * Deliberately not "add to a list": the note is the thing, and a video with a
   * note is Kept whether or not you went there. Answers whether anything was
   * created so a caller can tell a fresh save from a second press.
   */
  async saveItem(item: HubItem): Promise<boolean> {
    const made = await this.createNote(item);
    return made?.created ?? false;
  }

  /**
   * Turn an item into a Watch Later note and open it — the Watch button, and
   * what tapping a card used to do.
   *
   * Re-clicking a kept item opens what is already there.
   */
  async openItem(item: HubItem): Promise<void> {
    const made = await this.createNote(item);
    if (!made) return;

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(made.file);
    // A fresh note is for writing, so start the cursor in the Notes section
    // rather than at the top of the frontmatter.
    if (made.created && leaf.view instanceof MarkdownView) {
      const editor = leaf.view.editor;
      for (let i = 0; i < editor.lineCount(); i++) {
        if (editor.getLine(i) === NOTES_HEADING) {
          editor.setCursor({ line: i + 1, ch: 0 });
          editor.focus();
          break;
        }
      }
    }
  }

  /**
   * A note for this video is open, however it got opened.
   *
   * The hub's own click already keeps an item, but that is not the only way a
   * video gets watched: a note reached from the file explorer, a search result,
   * a link in another note or the phone's recent files left its hub row sitting
   * in the Inbox, undecided, for something that had plainly been decided.
   *
   * Kept is defined as "opened — a note exists", so this is that definition
   * applied to the other doors into the same room. Only ever promotes an
   * undecided item: a hidden video whose note you open stays hidden, because
   * hiding it was the more recent decision and 014 is the whole story of what
   * happens when the two devices disagree about which decision won.
   */
  noteOpened(videoId: string, notePath: string): void {
    const item = this.state.items.find((entry) => entry.videoId === videoId);
    if (!item || item.state !== "new") return;
    keepItem(item, notePath, new Date());
    this.emit();
    void this.save();
  }

  /**
   * Remove a video from the hub — which now means hiding it, not deleting it.
   *
   * `hideItem` strips it to a tombstone on the way out; see the note there for
   * why the description goes. The tombstone is what stops the video coming back
   * from a later poll, and what stops a search offering it to you again.
   */
  hide(item: HubItem): void {
    hideItem(this.live(item), new Date());
    this.emit();
    void this.save();
  }

  /**
   * The note for this video was deleted, so the video leaves every list.
   *
   * Not hiding: hiding is a judgement on the video and follows it into search
   * forever, and deleting a note is not that. The tombstone here only stops the
   * channel feed handing the same video back on the next poll — search can
   * still offer it, and adding it back from there clears the tombstone.
   *
   * A no-op when the video was never in the hub, so a deleted note that came
   * from the Web Clipper or a template costs nothing.
   */
  forget(videoId: string): void {
    if (!this.hasItem(videoId)) return;
    forgetVideo(this.state, videoId, new Date());
    this.emit();
    void this.save();
  }

  /**
   * The item in the current state with this video's ID — which is not always
   * the object the caller is holding.
   *
   * A merge rebuilds the items it reconciled, so a card rendered before the
   * last merge closes over an object that is no longer in `state.items`.
   * Mutating that orphan would drop the click on the floor, which is the exact
   * failure `mergeStates` exists to prevent. Identity is the video ID, never
   * the reference.
   *
   * An item that has vanished entirely — its channel was removed elsewhere —
   * is put back rather than silently ignored: you clicked it, so it is real.
   */
  private live(item: HubItem): HubItem {
    const found = this.state.items.find((i) => i.videoId === item.videoId);
    if (found) return found;
    // Putting it back is a re-add, so any tombstone from a deleted note goes —
    // otherwise the next merge would take it straight back out.
    rememberVideo(this.state, item.videoId);
    this.state.items.push(item);
    return item;
  }

  /**
   * Put a hidden video back in the Inbox.
   *
   * The description was dropped when it was hidden, so it is fetched again —
   * one player call, in the background, exactly like adding from search. The
   * item is usable before it lands: an empty description is a note that says so,
   * not a broken one.
   */
  async restore(item: HubItem): Promise<void> {
    const live = this.live(item);
    restoreItem(live);
    this.emit();
    void this.save();

    if (live.description) return;
    const details = await fetchVideoDetails(live.videoId);
    // Re-looked-up, not reused: that save merged, so the object above may have
    // been replaced while the round trip was in flight. Re-checked too — a
    // click during the round trip could have hidden it again, and writing a
    // description onto a tombstone would undo the compaction.
    const now = this.live(live);
    if (details.description && now.state !== "dismissed") {
      now.description = details.description;
      if (now.durationSeconds === undefined) now.durationSeconds = details.durationSeconds;
      void this.save();
    }
  }
}

/**
 * Everything a card needs, from either side.
 *
 * The two callers hand over facts, not objects: `buildCard` never learns what
 * a `HubItem` or a `SearchResult` is, which is what keeps one card definition
 * serving both lists.
 */
interface CardSpec {
  videoId: string;
  title: string;
  thumbnail: string;
  /** Already formatted — "12:04", "Short", or "" for a video with no length. */
  duration: string;
  /** The desktop's one line of facts. */
  deskSubText: string;
  /** The phone's two-part byline: who made it, and when. */
  phoneSub: { channel: string; trailing: string };
  /** How far in playback got, 0–1. Drawn along the foot of the thumbnail. */
  watched: number;
  extraClass?: string;
  /** Re-read on every repaint, so a button reflects the state it caused. */
  slots: () => CardSlot[];
  run: (key: CardActionKey, repaint: () => void) => Promise<void> | void;
}

interface CardButton {
  paint: (slot: CardSlot) => void;
}

/**
 * The four lists, in the order they are offered.
 *
 * A video is in exactly one of three states — undecided, kept (you opened it),
 * hidden (you turned it down) — and the first three chips are those states.
 * Everything is the union of the first two, and exists for one reason: it is
 * the only list where a video you already watched on YouTube still appears, and
 * the only place a search across both kept and undecided is one search.
 */
const FILTER_LABELS: ReadonlyArray<readonly [HubFilter, string]> = [
  ["new", "Inbox"],
  ["kept", "Kept"],
  ["hidden", "Hidden"],
  ["all", "Everything"],
];

/**
 * What each list contains, said in a sentence rather than implied by a word.
 *
 * This is the fix for "what is the difference between New and All": the
 * difference is one clause, and a chip has no room for a clause, so the status
 * line under the chips carries it.
 */
const FILTER_RULES: Record<HubFilter, string> = {
  new: "not opened, not hidden",
  kept: "opened — a note exists",
  hidden: "you removed these",
  all: "inbox + kept, including already-watched",
};

/**
 * The hub view.
 *
 * Redraws are explicit and never triggered by a click on an item. Clicking a
 * video in the Inbox makes it Kept, which under the filter would remove it
 * from the list and pull everything below it upward — so instead the card stays
 * where it is and only its marker changes. The list re-filters on the next
 * refresh, poll, or filter change.
 */
export class HubView extends ItemView {
  /**
   * Which screen you are on.
   *
   * "hub" is your own videos; "browse" is YouTube's. They were one screen with
   * one box doing both jobs, and that was the mistake issue 008 fixes: "narrow
   * what I am looking at" and "go and get something new" are different
   * intentions and now have different boxes on different screens.
   *
   * Switching rebuilds the view rather than toggling parts of it. That is a
   * deliberate navigation, not a click landing on a control, so the rule about
   * clicks never moving their neighbours is not in play — and everything either
   * screen needs is held in fields, so coming back restores what you left.
   */
  private mode: "hub" | "browse" = "hub";

  private filter: HubFilter = "new";
  private channelFilter: string | null = null;
  /** The hub's own box: free text over the list you are looking at. */
  private itemQuery = "";
  private unsubscribe: (() => void) | null = null;
  // Nullable, and re-assigned on every `build()`: a rebuilt view must not be
  // able to draw into the elements of the screen it replaced.
  private listEl: HTMLElement | null = null;
  private channelsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  /** Cards on screen right now, so a click can update one in place. */
  private cards = new Map<string, HTMLElement>();
  /** The columns the cards go in. Not the list: the sentinel sits outside it. */
  private gridEl: HTMLElement | null = null;
  /** How many pages of `CARD_PAGE` cards have been drawn — see `appendPage`. */
  private pages = 1;
  private sentinel: IntersectionObserver | null = null;
  private sentinelEl: HTMLElement | null = null;

  /**
   * Browse state. It outlives a trip back to the hub, so returning to the
   * search screen shows the results you left rather than an empty box.
   */
  private searchQuery: string | null = null;
  private searchResults: SearchResult[] = [];
  private searchContinuation: string | null = null;
  private searchState: "idle" | "loading" | "error" = "idle";
  private searchError = "";
  private searchInputEl: HTMLInputElement | null = null;
  private searchFilters: SearchFilters = defaultFilters();
  /** How many results this search dropped for already being in the hub. */
  private searchSkipped = 0;
  /** The two halves of the results list: the answer, then the related. */
  private primaryEl: HTMLElement | null = null;
  private relatedEl: HTMLElement | null = null;
  /** Result cards on screen, so Remove and Undo can swap one in place. */
  private results = new Map<string, HTMLElement>();
  /**
   * Results removed by hand, until the next search.
   *
   * Session-only on purpose at this stage: the persistent blocklist and the
   * Settings list that undoes it are stage two of the card-controls scope, and
   * a button that only pretends to persist is worse than one that says so.
   */
  private removedResults = new Set<string>();
  /** Bumped per search, so a slow first page cannot land over a newer one. */
  private searchToken = 0;

  /**
   * A phone gets a different menu, not a narrower one. See docs/MOBILE-UX.md:
   * the filters and the channel list collapse behind a single disclosure whose
   * label is the current selection, and any selection closes it again.
   */
  private readonly phone = Platform.isPhone;
  private menuEl: HTMLElement | null = null;
  private scrimEl: HTMLElement | null = null;
  private menuButtonEl: HTMLElement | null = null;
  private menuLabelEl: HTMLElement | null = null;
  private menuOpen = false;

  constructor(
    leaf: WorkspaceLeaf,
    private store: SubscriptionsStore,
    private settings: () => HubSettings,
    /** What the toolbar's sync button runs. Null falls back to a feed poll. */
    private sync: (() => Promise<void>) | null = null,
    /** Where playback got to, for the line under a thumbnail. */
    private progressFor: ((videoId: string) => number) | null = null,
    /**
     * Puts an ad-free player inside the Preview modal, and hands back the way
     * to tear it down. Null — no plugin behind this view, which is only ever
     * the case in a test — and Preview is the information sheet it was before
     * the player existed.
     */
    private mountPreview: PreviewMount | null = null,
    /**
     * Opens the share menu against a control in the Preview sheet. The hub
     * knows what to share; the plugin knows what "share" means on this
     * platform — a clipboard, or the phone's own sheet.
     */
    private shareMenu: ShareMenu | null = null,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return HUB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "YT Free subscriptions";
  }

  getIcon(): string {
    return YT_ICON;
  }

  async onOpen(): Promise<void> {
    // Only the parts that change are redrawn — see the note on the class.
    this.unsubscribe = this.store.onChange(() => {
      this.renderStatus();
      this.renderChannels();
      this.renderMenuLabel();
    });
    this.build();
    this.renderAll();
    // The phone may have hidden something since this window last looked. Cheap
    // — a stat — and it redraws itself through `onChange` if anything moved.
    void this.store.refreshFromDisk();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private build(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("ytfree-hub");
    // NOT `is-phone`: that is Obsidian's own body class, and its rule block
    // redeclares `--view-top-spacing: 0`. Putting it on the view-content made
    // the element redefine the variable Obsidian's own
    // `.is-phone .mod-root … .view-content { margin-top: var(--view-top-spacing) }`
    // reads, so the hub lost the space reserved for the fixed view header and
    // sat underneath it. Namespaced class, no collision.
    root.toggleClass("ytfree-phone", this.phone);

    // A rebuild throws away the previous screen's elements. Anything the store
    // listener might draw into has to be forgotten with them.
    this.listEl = null;
    this.channelsEl = null;
    this.statusEl = null;
    this.primaryEl = null;
    this.relatedEl = null;
    this.searchInputEl = null;
    this.menuEl = null;
    this.scrimEl = null;
    this.menuButtonEl = null;
    this.menuLabelEl = null;
    this.menuOpen = false;
    this.cards.clear();

    if (this.mode === "browse") this.buildBrowse(root);
    else this.buildHub(root);
  }

  // ------------------------------------------------------------ the hub screen

  private buildHub(root: HTMLElement): void {
    const header = root.createDiv({ cls: "ytfree-hub-header" });

    // Phone: the filters move into the collapsible menu and the header carries
    // only the disclosure that says what is currently selected.
    if (this.phone) this.buildDisclosure(header);
    else this.buildFilters(header);

    const actions = header.createDiv({ cls: "ytfree-hub-actions" });

    // The way to YouTube. An icon rather than a box, because the thing it opens
    // is a screen: putting a second text field next to the filter box was how
    // the two jobs got confused with each other in the first place.
    const browse = actions.createEl("button", {
      cls: "ytfree-hub-icon-button",
      attr: { type: "button", "aria-label": "Search YouTube", title: "Search YouTube" },
    });
    setIcon(browse, YT_ICON);
    browse.addEventListener("click", () => this.setMode("browse"));

    // The same thing the settings pane's "Sync now" runs, notices included, so
    // there is only one meaning of "sync" in the plugin.
    const refresh = actions.createEl("button", { cls: "ytfree-hub-icon-button" });
    refresh.setAttribute("aria-label", "Sync now — your account, then the channel feeds");
    refresh.setAttribute("title", "Sync now — your account, then the channel feeds");
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => {
      const run = this.sync ? this.sync() : this.store.poll();
      void run.then(() => this.renderAll());
    });

    this.buildItemFilter(root);
    this.statusEl = root.createDiv({ cls: "ytfree-hub-status" });

    const body = root.createDiv({ cls: "ytfree-hub-body" });
    if (this.phone) this.buildPhoneBody(body);
    else {
      this.channelsEl = body.createDiv({ cls: "ytfree-hub-channels" });
      this.listEl = body.createDiv({ cls: "ytfree-hub-list" });
    }
  }

  /**
   * The hub's own box. It filters the list in front of you and touches nothing
   * else — no network, no YouTube, no mode to get out of.
   *
   * Filtering happens on every keystroke because it is free: the items are
   * already in memory, and a list that answers while you are still typing is
   * the entire reason to have this rather than a second search.
   */
  private buildItemFilter(root: HTMLElement): void {
    const row = root.createDiv({ cls: "ytfree-hub-search" });

    const input = row.createEl("input", {
      cls: "ytfree-hub-search-input",
      // `search` gives iOS a Search key and both platforms a native clear
      // control, which fires `input` like any other edit — so clearing by hand
      // and clearing with the × take the same path.
      type: "search",
      attr: {
        placeholder: "Filter these videos",
        enterkeyhint: "search",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
        "aria-label": "Filter the videos in your hub",
      },
    });
    // Survives a trip to the search screen and back, like everything else here.
    input.value = this.itemQuery;

    const apply = (): void => {
      this.itemQuery = input.value;
      this.renderList();
      this.renderStatus();
    };
    input.addEventListener("input", apply);
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        input.value = "";
        apply();
      }
    });
  }

  /**
   * The filter chips. Same markup either side; only the host differs.
   *
   * The labels are the three things that can have happened to a video, not four
   * adjectives: **Inbox** is what you have not decided about, **Kept** is what
   * you opened, **Hidden** is what you turned down, and **Everything** is the
   * first two in one list. "New" and "All" described the same list to anyone
   * who had not read `visibleItems` — they differ only by Kept items and by
   * ones YouTube says you already watched, which is not a difference two
   * one-word labels can carry. Each chip states its own rule underneath — see
   * `filterRule`.
   */
  private buildFilters(host: HTMLElement): void {
    const filters = host.createDiv({ cls: "ytfree-hub-filters" });
    for (const [value, label] of FILTER_LABELS) {
      const button = filters.createEl("button", {
        text: label,
        cls: "ytfree-hub-filter",
        attr: { title: FILTER_RULES[value] },
      });
      button.toggleClass("is-active", this.filter === value);
      button.addEventListener("click", () => {
        this.filter = value;
        for (const el of Array.from(filters.children)) {
          el.toggleClass("is-active", el === button);
        }
        this.renderList();
        this.renderStatus();
        this.renderMenuLabel();
        // A choice made is a menu finished with — that is the space it was
        // borrowing, handed straight back to the list.
        this.setMenuOpen(false);
      });
    }
  }

  // --------------------------------------------------------- the browse screen

  private buildBrowse(root: HTMLElement): void {
    const header = root.createDiv({ cls: "ytfree-hub-header" });

    const back = header.createEl("button", {
      cls: "ytfree-hub-icon-button",
      attr: { type: "button", "aria-label": "Back to your hub", title: "Back to your hub" },
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => this.setMode("hub"));

    header.createDiv({ cls: "ytfree-hub-screen-title", text: "Search YouTube" });

    const row = root.createDiv({ cls: "ytfree-hub-search" });
    const input = row.createEl("input", {
      cls: "ytfree-hub-search-input",
      type: "search",
      attr: {
        placeholder: "Search YouTube",
        enterkeyhint: "search",
        autocapitalize: "off",
        autocorrect: "off",
        spellcheck: "false",
        "aria-label": "Search YouTube",
      },
    });
    this.searchInputEl = input;
    input.value = this.searchQuery ?? "";

    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.runSearch(input.value);
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        this.exitSearch();
      }
    });
    // Emptying the box empties the results — however it was emptied: backspace,
    // the native ×, or a paste of nothing.
    input.addEventListener("input", () => {
      if (input.value.trim() === "" && this.searchQuery !== null) this.exitSearch();
    });

    const go = row.createEl("button", {
      cls: "ytfree-hub-icon-button",
      attr: { type: "button", "aria-label": "Search", title: "Search" },
    });
    setIcon(go, "search");
    go.addEventListener("click", () => this.runSearch(input.value));

    this.buildSearchFilters(root);
    this.statusEl = root.createDiv({ cls: "ytfree-hub-status" });

    const body = root.createDiv({ cls: "ytfree-hub-body" });
    this.listEl = body.createDiv({ cls: "ytfree-hub-list" });
  }

  /**
   * YouTube's filter panel, as four selects.
   *
   * Selects rather than chips, and one feature rather than YouTube's checkbox
   * set, for the same reason: a `<select>` is a fixed box whose contents change
   * without the control changing size, so choosing a filter cannot move the
   * results underneath it. They are also the one control iOS renders as a
   * proper picker without any help.
   *
   * Every one of these is sent to YouTube — see `search-params.ts`. Nothing is
   * filtered here out of a page we already fetched, which is the difference
   * between "over 20 minutes" meaning it and it meaning "the long ones out of
   * these twenty".
   */
  private buildSearchFilters(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "ytfree-hub-filterbar" });

    const select = <T extends string>(
      label: string,
      options: Array<[T, string]>,
      current: T,
      onPick: (value: T) => void,
    ): void => {
      const el = bar.createEl("select", {
        cls: "dropdown ytfree-hub-filterbar-select",
        attr: { "aria-label": label, title: label },
      });
      for (const [value, text] of options) {
        el.createEl("option", { value, text });
      }
      el.value = current;
      el.addEventListener("change", () => {
        onPick(el.value as T);
        // A filter change is a different search, not a different reading of the
        // one you already have — so it goes back to YouTube. Only if there is
        // something to search for: changing a filter with an empty box sets it
        // up for the query you have not typed yet.
        if (this.searchQuery) this.runSearch(this.searchQuery);
      });
    };

    select("Upload date", UPLOAD_DATE_OPTIONS, this.searchFilters.uploadDate, (value) => {
      this.searchFilters.uploadDate = value;
    });
    select("Duration", DURATION_OPTIONS, this.searchFilters.duration, (value) => {
      this.searchFilters.duration = value;
    });
    select("Type", FEATURE_OPTIONS, this.searchFilters.feature, (value) => {
      this.searchFilters.feature = value;
    });
    select("Sort by", SORT_OPTIONS, this.searchFilters.sort, (value) => {
      this.searchFilters.sort = value;
    });
  }

  /** Swap screens. Everything either one needs is in a field, so this is safe. */
  private setMode(mode: "hub" | "browse"): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.build();
    this.renderAll();
    // Landing on the search screen with an empty box should put the cursor in
    // it. Not on a phone: that would raise the keyboard over the results you
    // came back to look at.
    if (mode === "browse" && !this.phone && !this.searchQuery) this.searchInputEl?.focus();
  }

  /**
   * The phone's single menu control. Its label is the current selection, so the
   * closed state still says what you are looking at and the menu itself can
   * stay out of the way.
   */
  private buildDisclosure(header: HTMLElement): void {
    const button = header.createEl("button", {
      cls: "ytfree-hub-select",
      attr: { type: "button", "aria-expanded": "false" },
    });
    this.menuLabelEl = button.createSpan({ cls: "ytfree-hub-select-label" });
    const chevron = button.createSpan({ cls: "ytfree-hub-select-chevron" });
    setIcon(chevron, "chevron-down");
    button.addEventListener("click", () => this.setMenuOpen(!this.menuOpen));
    this.menuButtonEl = button;
  }

  /**
   * List first, menu over the top of it.
   *
   * The menu is absolutely positioned and toggled with `visibility`, so opening
   * or closing it cannot resize the list or move a single card. Its height is
   * fixed whichever section you are reading, so it cannot resize itself either.
   */
  private buildPhoneBody(body: HTMLElement): void {
    this.listEl = body.createDiv({ cls: "ytfree-hub-list" });

    this.scrimEl = body.createDiv({ cls: "ytfree-hub-scrim" });
    this.scrimEl.addEventListener("click", () => this.setMenuOpen(false));

    this.menuEl = body.createDiv({ cls: "ytfree-hub-menu" });
    this.menuEl.createDiv({ cls: "ytfree-hub-menu-heading", text: "Show" });
    this.buildFilters(this.menuEl);
    this.menuEl.createDiv({ cls: "ytfree-hub-menu-heading", text: "Channels" });
    this.channelsEl = this.menuEl.createDiv({ cls: "ytfree-hub-channels" });
  }

  private setMenuOpen(open: boolean): void {
    if (!this.menuEl || !this.scrimEl) return;
    this.menuOpen = open;
    this.menuEl.toggleClass("is-open", open);
    this.scrimEl.toggleClass("is-open", open);
    this.menuButtonEl?.toggleClass("is-open", open);
    this.menuButtonEl?.setAttribute("aria-expanded", String(open));
    // Reopening starts at the top rather than wherever the channel list was
    // left, which is what makes the filter chips reachable every time.
    if (open) this.menuEl.scrollTop = 0;
  }

  /** What the collapsed menu says: the filter, then the channel. */
  private renderMenuLabel(): void {
    if (!this.menuLabelEl) return;
    const filterLabel = FILTER_LABELS.find(([value]) => value === this.filter)?.[1] ?? "Inbox";
    const channel = this.channelFilter
      ? (this.store.state.channels.find((c) => c.id === this.channelFilter)?.title ?? "Channel")
      : "All channels";
    this.menuLabelEl.setText(`${filterLabel} · ${channel}`);
  }

  renderAll(): void {
    this.renderStatus();
    this.renderChannels();
    this.renderMenuLabel();
    this.renderList();
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
    if (this.mode === "browse") {
      this.statusEl.setText(this.browseStatus());
      return;
    }

    const { channels, items, lastPolledAt } = this.store.state;
    const shown = this.currentItems().length;
    const parts: string[] = [];
    if (this.store.polling) parts.push("Checking channels…");
    else if (channels.length === 0) parts.push("No channels yet — import your subscriptions.");
    else if (this.itemQuery) {
      parts.push(`${shown} match${shown === 1 ? "" : "es"} for “${this.itemQuery}”`);
    } else {
      // The count, then the rule that produced it. Which list you are on and
      // what it means are the same question, so they get the same line — and
      // the count is of this list, not of the hub, which is what made "42 of
      // 264 videos" read as an arbitrary slice.
      const noun = shown === 1 ? "video" : "videos";
      parts.push(`${shown} ${noun} · ${FILTER_RULES[this.filter]}`);
      if (this.filter === "hidden" && shown > 0) parts.push("put one back with the arrow");
    }
    if (lastPolledAt && !this.store.polling && this.filter !== "hidden") {
      parts.push(`checked ${relativeAge(lastPolledAt, new Date())}`);
    }
    this.statusEl.setText(parts.join(" · "));
  }

  /** The search screen's own status line. */
  private browseStatus(): string {
    if (this.searchQuery === null) {
      return isDefaultFilters(this.searchFilters)
        ? "Type something and press Enter. Nothing here plays — a result can only be added to your hub."
        : "Filters set. Type something and press Enter.";
    }
    if (this.searchState === "error") return `Search failed — ${this.searchError}`;
    if (this.searchState === "loading" && this.searchResults.length === 0) {
      return `Searching for “${this.searchQuery}”…`;
    }

    // Said out loud, because "nothing found" and "found nothing you have not
    // already dealt with" are different answers and only one of them is worth
    // rewording the query over.
    const skipped = this.searchSkipped
      ? ` · ${this.searchSkipped} already in your hub, not shown`
      : "";
    if (this.searchResults.length === 0) {
      return this.searchSkipped
        ? `Everything found for “${this.searchQuery}” is already in your hub.`
        : `Nothing found for “${this.searchQuery}”.`;
    }
    return `${this.searchResults.length} results for “${this.searchQuery}”${skipped} · click one to add it`;
  }

  private renderChannels(): void {
    if (!this.channelsEl) return;
    this.channelsEl.empty();

    const all = this.channelsEl.createDiv({ cls: "ytfree-hub-channel" });
    all.toggleClass("is-active", this.channelFilter === null);
    all.createSpan({ text: "All channels", cls: "ytfree-hub-channel-name" });
    all.addEventListener("click", () => this.selectChannel(null));

    const counts = new Map<string, number>();
    for (const item of this.store.state.items) {
      if (item.state !== "new") continue;
      counts.set(item.channelId, (counts.get(item.channelId) ?? 0) + 1);
    }

    const sorted = [...this.store.state.channels].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    for (const channel of sorted) {
      const row = this.channelsEl.createDiv({ cls: "ytfree-hub-channel" });
      row.toggleClass("is-active", this.channelFilter === channel.id);
      row.createSpan({ text: channel.title, cls: "ytfree-hub-channel-name" });
      // Reserved either way, so a count appearing never re-lays out the row.
      const badge = row.createSpan({ cls: "ytfree-hub-channel-count" });
      badge.setText(channel.error ? "!" : String(counts.get(channel.id) ?? ""));
      if (channel.error) {
        row.addClass("is-broken");
        row.setAttribute("aria-label", `Feed failed: ${channel.error}`);
        row.setAttribute("title", `Feed failed: ${channel.error}`);
      }
      row.addEventListener("click", () => this.selectChannel(channel.id));
    }
  }

  private selectChannel(channelId: string | null): void {
    this.channelFilter = channelId;
    this.renderChannels();
    this.renderList();
    this.renderStatus();
    this.renderMenuLabel();
    this.setMenuOpen(false);
  }

  private currentItems(): HubItem[] {
    return visibleItems(this.store.state.items, {
      filter: this.filter,
      channelId: this.channelFilter,
      includeShorts: this.settings().includeShorts,
      showWatched: this.settings().showWatched,
      query: this.itemQuery,
    });
  }

  // --------------------------------------------------------------- search

  /**
   * Drop the results you have already dealt with.
   *
   * "Dealt with" is anything the hub knows about: saved, kept, or hidden. A
   * video you removed is a decision, and offering it back in a search two
   * minutes later is the search arguing with you.
   *
   * This runs when a page *lands*, not when a card is drawn, which is what
   * keeps it compatible with the no-reflow rule: a result you add while looking
   * at it stays exactly where it is, with a tick, because it was already in
   * `searchResults` before you clicked.
   */
  private acceptable(results: SearchResult[]): SearchResult[] {
    const shown = new Set(this.searchResults.map((result) => result.videoId));
    return results.filter(
      (result) => !shown.has(result.videoId) && !this.store.hasItem(result.videoId),
    );
  }

  /**
   * Fetch pages until one of them survives `acceptable`, or the road runs out.
   *
   * Without this, a search whose whole first page is already in your hub would
   * answer "nothing found" while sitting on a continuation token full of
   * results. Three extra pages is the budget: enough for a query you have
   * mostly worked through, bounded enough that a pathological one cannot turn a
   * click into sixty requests.
   */
  private async fetchPage(
    query: string,
    continuation: string | null,
  ): Promise<{ results: SearchResult[]; continuation: string | null; skipped: number }> {
    let token = continuation;
    let skipped = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const page: SearchPage = await searchYouTube(query, this.searchFilters, token);
      const fresh = this.acceptable(page.results);
      skipped += page.results.length - fresh.length;
      token = page.continuation;
      if (fresh.length > 0 || !token) return { results: fresh, continuation: token, skipped };
    }
    return { results: [], continuation: token, skipped };
  }

  /**
   * Empty the search. The box is cleared and the results are dropped; the
   * filters are not, because they are a setting for this screen rather than
   * part of the query.
   */
  private clearSearch(): void {
    if (this.searchQuery === null) return;
    // Any page still in flight belongs to a search that no longer exists.
    this.searchToken++;
    this.searchQuery = null;
    this.searchResults = [];
    this.searchContinuation = null;
    this.searchState = "idle";
    this.searchError = "";
    this.searchSkipped = 0;
    this.removedResults.clear();
    if (this.searchInputEl) this.searchInputEl.value = "";
  }

  private exitSearch(): void {
    this.clearSearch();
    this.renderList();
    this.renderStatus();
  }

  private runSearch(query: string): void {
    const text = query.trim();
    if (!text) {
      this.exitSearch();
      return;
    }

    const token = ++this.searchToken;
    this.searchQuery = text;
    this.searchResults = [];
    this.searchContinuation = null;
    this.searchState = "loading";
    this.searchError = "";
    this.searchSkipped = 0;
    this.removedResults.clear();
    this.renderList();
    this.renderStatus();

    void this.fetchPage(text, null)
      .then(
        (page) => {
          if (token !== this.searchToken) return;
          this.searchResults = page.results;
          this.searchContinuation = page.continuation;
          this.searchSkipped = page.skipped;
          this.searchState = "idle";
        },
        (err: unknown) => {
          if (token !== this.searchToken) return;
          this.searchState = "error";
          this.searchError = err instanceof Error ? err.message : String(err);
        },
      )
      .then(() => {
        if (token !== this.searchToken) return;
        this.renderList();
        this.renderStatus();
      });
  }

  /**
   * One more page, appended.
   *
   * Appended rather than re-rendered: the results you were reading must not
   * move, and re-running `renderSearch` would rebuild the list under your
   * scroll position.
   */
  private loadMore(button: HTMLElement): void {
    const query = this.searchQuery;
    const continuation = this.searchContinuation;
    if (!query || !continuation || this.searchState === "loading") return;

    const token = this.searchToken;
    this.searchState = "loading";
    button.setText("Loading…");

    void this.fetchPage(query, continuation).then(
      (page) => {
        if (token !== this.searchToken) return;
        this.searchResults = [...this.searchResults, ...page.results];
        this.searchContinuation = page.continuation;
        this.searchSkipped += page.skipped;
        this.searchState = "idle";
        const now = new Date();
        for (const result of page.results) this.renderResult(result, now);
        button.setText("More results");
        // The end of the road: YouTube stopped offering a token, or answered
        // with nothing new. Either way there is no page after this one.
        if (!page.continuation || page.results.length === 0) button.remove();
        this.renderStatus();
      },
      (err: unknown) => {
        if (token !== this.searchToken) return;
        this.searchState = "idle";
        button.setText("More results");
        new Notice(`YT Free: could not load more results — ${String(err)}`);
      },
    );
  }

  private renderSearch(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();
    this.cards.clear();
    this.results.clear();
    this.primaryEl = null;
    this.relatedEl = null;

    if (this.searchState === "error") {
      list.createDiv({ cls: "ytfree-hub-empty", text: `Search failed — ${this.searchError}` });
      return;
    }
    if (this.searchState === "loading" && this.searchResults.length === 0) {
      list.createDiv({ cls: "ytfree-hub-empty", text: "Searching YouTube…" });
      return;
    }
    if (this.searchQuery === null) {
      list.createDiv({
        cls: "ytfree-hub-empty",
        text: "Nothing searched for yet.",
      });
      return;
    }
    if (this.searchResults.length === 0) {
      list.createDiv({
        cls: "ytfree-hub-empty",
        text: this.searchSkipped
          ? "Everything this found is already in your hub."
          : "No results.",
      });
      return;
    }

    // Two hosts, created up front and in this order, so an appended page lands
    // in the right half without anything above it being redrawn. Each is a card
    // grid in its own right — two-up on a phone, a column on a desktop.
    this.primaryEl = list.createDiv({ cls: "ytfree-hub-results ytfree-hub-grid" });
    this.relatedEl = list.createDiv({ cls: "ytfree-hub-results ytfree-hub-grid" });

    const now = new Date();
    for (const result of this.searchResults) this.renderResult(result, now);

    if (this.searchContinuation) {
      const more = list.createEl("button", {
        cls: "ytfree-hub-more",
        text: "More results",
        attr: { type: "button" },
      });
      more.addEventListener("click", () => this.loadMore(more));
    }
  }

  /**
   * Where a result goes: the answer, or the related material below it.
   *
   * The heading is created with the first related result rather than reserved,
   * because it is at the bottom of a list that is being appended to — there is
   * nothing below it to move.
   */
  private resultHost(result: SearchResult): HTMLElement | null {
    if (!result.secondary) return this.primaryEl;
    const related = this.relatedEl;
    if (related && related.childElementCount === 0) {
      related.createDiv({
        cls: "ytfree-hub-results-heading",
        text: "Related to your search",
      });
    }
    return related;
  }

  /**
   * A search result card.
   *
   * The same card as the hub's, with the same four buttons in the same four
   * positions, and different meanings underneath: Save adds to the Inbox and
   * makes no note, Watch adds it as Kept and goes to the note, and Remove takes
   * it out of the results rather than out of the hub. There is still no link,
   * no anchor and no `<video>` here — see `docs/V1-SCOPE-BROWSE.md`.
   */
  private renderResult(result: SearchResult, now: Date): void {
    const host = this.resultHost(result);
    if (!host) return;
    if (this.removedResults.has(result.videoId)) {
      host.appendChild(this.buildRemovedStrip(result));
      return;
    }

    const facts = (): CardFacts => ({
      inHub: this.store.hasItem(result.videoId),
      noteExists: this.store.hasNote(result.videoId),
    });

    const card = this.buildCard({
      extraClass: "ytfree-hub-result",
      videoId: result.videoId,
      title: result.title,
      thumbnail: result.thumbnail,
      duration: result.duration,
      // Search knows the view count; the hub's own feed does not. It is the
      // segment a phone drops — see the byline below.
      deskSubText: [result.channelTitle, result.publishedText, formatViews(result.views)]
        .filter(Boolean)
        .join(" · "),
      phoneSub: { channel: result.channelTitle, trailing: result.publishedText },
      watched: 0,
      slots: () => searchSlots(facts()),
      run: (key, repaint) => this.runResultAction(key, result, repaint),
    });
    // A search card is not tracked in `cards` — a results list is rebuilt whole
    // — but Remove has to find this one element to swap it for the strip, and
    // Undo has to swap it back without redrawing anything above it.
    this.results.set(result.videoId, card);
    host.appendChild(card);
  }

  /**
   * One search action, from the card or from inside the preview.
   *
   * Save and Watch both have to get the video into the hub first — a result is
   * not an item until something adds it — so both go through `addSearchResult`
   * and then look the item up by ID rather than holding the object across the
   * round trip.
   */
  private async runResultAction(
    key: CardActionKey,
    result: SearchResult,
    repaint: () => void,
  ): Promise<void> {
    if (key === "preview") {
      this.openPreview(result.videoId, repaint);
      return;
    }
    if (key === "remove") {
      this.removeResult(result);
      return;
    }

    await this.store.addSearchResult(result);
    const item = this.store.itemFor(result.videoId);
    if (!item) return;
    if (key === "save") await this.store.saveItem(item);
    else await this.store.openItem(item);
    this.renderStatus();
  }

  /**
   * Remove on a search card: session-only, and undoable where it happened.
   *
   * The card collapses in place to a strip of the same height, so removing the
   * third result does not pull the fourth up under your thumb. It survives
   * until the next search and no further — the persistent blocklist and the
   * Settings list are stage two of `docs/V1-SCOPE-CARD-CONTROLS.md`.
   */
  private removeResult(result: SearchResult): void {
    this.removedResults.add(result.videoId);
    const card = this.results.get(result.videoId);
    if (!card?.isConnected) return;
    const strip = this.buildRemovedStrip(result);
    // Measured, not guessed: "same height" is the whole point of the strip, and
    // a card's height depends on how many lines its title took.
    strip.style.height = `${card.offsetHeight}px`;
    card.replaceWith(strip);
    this.results.set(result.videoId, strip);
  }

  /**
   * "Removed — Undo", at the height of the card it replaced.
   *
   * Undo swaps the card straight back in rather than re-rendering the results:
   * a redraw of the list under a finger that has just pressed Undo is the same
   * reflow the strip exists to avoid.
   */
  private buildRemovedStrip(result: SearchResult): HTMLElement {
    const strip = createDiv({ cls: "ytfree-hub-card ytfree-hub-removed" });
    strip.createDiv({ cls: "ytfree-hub-removed-text", text: "Removed" });
    const undo = strip.createEl("button", {
      cls: "ytfree-hub-removed-undo",
      text: "Undo",
      attr: { type: "button" },
    });
    undo.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.removedResults.delete(result.videoId);
      const host = strip.parentElement;
      if (!host) return;
      const marker = strip.nextSibling;
      strip.remove();
      this.results.delete(result.videoId);
      this.renderResult(result, new Date());
      // `renderResult` appends; put it back where the strip was.
      const rebuilt = this.results.get(result.videoId);
      if (rebuilt && marker) host.insertBefore(rebuilt, marker);
    });
    return strip;
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    if (this.mode === "browse") {
      this.renderSearch();
      return;
    }
    list.empty();
    this.cards.clear();
    this.stopSentinel();
    this.pages = 1;

    const items = this.currentItems();
    if (items.length === 0) {
      list.createDiv({ cls: "ytfree-hub-empty", text: this.emptyMessage() });
      return;
    }

    const now = new Date();
    if (this.filter === "hidden") {
      for (const item of items) this.renderHiddenRow(item, now);
      return;
    }

    // A two-up grid roughly triples the cards on a screen, so the list is
    // drawn a page at a time. The grid is a real element rather than the list
    // itself, because the sentinel below has to sit outside the columns.
    const grid = list.createDiv({ cls: "ytfree-hub-grid" });
    this.gridEl = grid;
    for (const item of items.slice(0, shownCount(items.length, this.pages))) {
      this.renderCard(item, now);
    }
    this.armSentinel(list, () => this.appendPage());
  }

  /**
   * The next page of hub cards, appended.
   *
   * Re-reads `currentItems()` rather than closing over the array from the first
   * render: a poll can land between two scrolls, and appending from a stale
   * list would draw a card the current filter no longer contains.
   */
  private appendPage(): void {
    const grid = this.gridEl;
    if (!grid?.isConnected) return;
    const items = this.currentItems();
    const from = shownCount(items.length, this.pages);
    if (from >= items.length) {
      this.stopSentinel();
      return;
    }
    this.pages += 1;
    const now = new Date();
    for (const item of items.slice(from, shownCount(items.length, this.pages))) {
      this.renderCard(item, now);
    }
    if (shownCount(items.length, this.pages) >= items.length) this.stopSentinel();
  }

  /**
   * A one-pixel element at the foot of the list, watched rather than polled.
   *
   * `root: list` because the hub's scroller is the list element, not the
   * window: on a phone the view is inside Obsidian's own layout and the
   * viewport never moves.
   */
  private armSentinel(list: HTMLElement, onSeen: () => void): void {
    this.sentinelEl = list.createDiv({ cls: "ytfree-hub-sentinel" });
    this.sentinel = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onSeen();
      },
      { root: list, rootMargin: "400px" },
    );
    this.sentinel.observe(this.sentinelEl);
  }

  /** Nothing may append into a list that has been replaced. */
  private stopSentinel(): void {
    this.sentinel?.disconnect();
    this.sentinel = null;
    this.sentinelEl?.remove();
    this.sentinelEl = null;
    this.gridEl = null;
  }

  private emptyMessage(): string {
    if (this.itemQuery) return `Nothing in this list matches “${this.itemQuery}”.`;
    if (this.filter === "hidden") {
      return "Nothing hidden. Removing a video from the hub puts it here.";
    }
    return this.store.state.channels.length === 0
      ? "Run “YT Free: Import YouTube subscriptions” to get started."
      : "Nothing here. Try Everything, or check for new videos.";
  }

  /**
   * One hidden video: a line of text and a way back.
   *
   * Deliberately not a card. A hidden item has no thumbnail stored — see
   * `hideItem` — and drawing one would mean rebuilding the URL and fetching an
   * image per row for a list whose entire job is to be cheap. The title and the
   * channel are what you came to recognise it by.
   */
  private renderHiddenRow(item: HubItem, now: Date): void {
    const list = this.listEl;
    if (!list) return;
    const row = list.createDiv({ cls: "ytfree-hub-card ytfree-hub-hidden-row" });
    this.cards.set(item.videoId, row);

    const meta = row.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: item.title });
    const hiddenAge = relativeAge(item.dismissedAt ?? "", now);
    meta.createDiv({
      cls: "ytfree-hub-sub",
      text: [item.channelTitle, hiddenAge ? `hidden ${hiddenAge}` : "hidden"]
        .filter(Boolean)
        .join(" · "),
    });

    const actions = row.createDiv({ cls: "ytfree-hub-dismiss" });
    const restore = new ButtonComponent(actions)
      .setIcon("rotate-ccw")
      .setTooltip("Put back in the hub")
      .onClick((evt) => {
        evt.stopPropagation();
        void this.store.restore(item).catch((err: unknown) => {
          new Notice(`YT Free: could not restore that video — ${String(err)}`);
        });
        // It is no longer hidden, so it no longer belongs in this list. Same
        // as removing one from the Inbox: the row you acted on goes, and
        // nothing else is redrawn.
        row.remove();
        this.cards.delete(item.videoId);
        if (this.cards.size === 0) this.renderList();
        this.renderStatus();
      });
    restore.buttonEl.addClass("ytfree-hub-icon-button");
  }

  /**
   * One video in the list.
   *
   * The same card as a search result's, with the hub's meanings on the four
   * buttons. The dismiss column, the marker column and the phone's badge are
   * all gone: Remove is one of the four now, and what used to be a tick in a
   * reserved column is a state on the button that caused it.
   */
  private renderCard(item: HubItem, now: Date): void {
    const grid = this.gridEl;
    if (!grid) return;

    const facts = (): CardFacts => ({
      inHub: true,
      noteExists: Boolean(this.store.itemFor(item.videoId)?.notePath),
    });

    // "Short" only where there is no length to state — a 45-second video says
    // 0:45, which is the same fact more precisely.
    const length = formatDuration(item.durationSeconds);
    const { channel, trailing } = phoneSubParts(item, now);

    const card = this.buildCard({
      videoId: item.videoId,
      title: item.title,
      thumbnail: item.thumbnail,
      duration: length || (item.isShort ? "Short" : ""),
      deskSubText: deskSub(item, now),
      phoneSub: { channel, trailing },
      watched: watchedFraction(this.resumeAt(item.videoId), item.durationSeconds),
      slots: () => hubSlots(facts()),
      run: (key, repaint) => this.runItemAction(key, item, repaint),
    });
    card.toggleClass("is-watched", Boolean(item.watched));

    this.cards.set(item.videoId, card);
    grid.appendChild(card);
  }

  /** One hub action, from the card or from inside the preview. */
  private async runItemAction(
    key: CardActionKey,
    item: HubItem,
    repaint: () => void,
  ): Promise<void> {
    if (key === "preview") {
      this.openPreview(item.videoId, repaint);
      return;
    }
    if (key === "remove") {
      this.store.hide(item);
      const card = this.cards.get(item.videoId);
      card?.remove();
      this.cards.delete(item.videoId);
      // The empty state is part of the list, so an emptied list is re-rendered
      // rather than left blank.
      if (this.cards.size === 0) this.renderList();
      this.renderStatus();
      return;
    }
    if (key === "save") {
      // Saving makes the video Kept, so it no longer belongs in the Inbox and
      // leaves it at once — same as Remove and Watch. A card that answers a
      // filter it no longer matches is a lie about the list; the list is what
      // it says it is, immediately. On the Kept list the item still matches, so
      // `dropIfFiltered` leaves it alone.
      await this.store.saveItem(item);
      this.dropIfFiltered(item.videoId);
      this.renderStatus();
      return;
    }
    await this.store.openItem(item);
    this.dropIfFiltered(item.videoId);
    this.renderStatus();
  }

  /**
   * The card, once, for both lists.
   *
   * Picture, two lines of title, a byline and four buttons — see
   * `docs/V1-SCOPE-CARD-CONTROLS.md`. The shape is identical on both surfaces
   * and on both platforms; what differs is the stylesheet (two-up grid on a
   * phone, a row on a desktop) and what the four buttons do, which the caller
   * supplies. Nothing here knows what a hub item or a search result is.
   */
  private buildCard(spec: CardSpec): HTMLElement {
    const card = createDiv({ cls: "ytfree-hub-card" });
    if (spec.extraClass) card.addClass(spec.extraClass);

    const thumb = card.createDiv({ cls: "ytfree-hub-thumb" });
    if (spec.thumbnail) {
      const img = thumb.createEl("img");
      img.src = spec.thumbnail;
      img.loading = "lazy";
      img.alt = "";
    }
    // Bottom-right of the picture, where a YouTube reader already looks. Empty
    // is hidden rather than absent, so a video with no stated length leaves the
    // thumbnail exactly the same size.
    thumb.createSpan({ cls: "ytfree-hub-duration", text: spec.duration });

    // How far in you got, as a line along the bottom edge of the thumbnail —
    // YouTube's own convention, and the only progress indicator that costs a
    // 178px card no height. Always drawn; a fresh video's line is zero wide.
    const fill = thumb
      .createDiv({ cls: "ytfree-hub-progress" })
      .createDiv({ cls: "ytfree-hub-progress-fill" });
    fill.style.width = `${Math.round(spec.watched * 100)}%`;

    const meta = card.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: spec.title });
    if (this.phone) this.renderPhoneSub(meta, spec.phoneSub.channel, spec.phoneSub.trailing);
    else meta.createDiv({ cls: "ytfree-hub-sub", text: spec.deskSubText });

    const actions = card.createDiv({ cls: "ytfree-card-actions" });
    const buttons = new Map<CardActionKey, CardButton>();
    const repaint = (): void => {
      for (const slot of spec.slots()) buttons.get(slot.key)?.paint(slot);
    };
    for (const slot of spec.slots()) {
      buttons.set(slot.key, this.buildAction(actions, slot, spec.run, repaint));
    }
    repaint();

    // The card body is Preview: the safe, reversible action gets the largest
    // target on the screen, and the three consequential ones have their own
    // buttons. A click that started on a button never reaches here — see
    // `buildAction`.
    card.addEventListener("click", () => {
      void Promise.resolve(spec.run("preview", repaint)).then(repaint, (err: unknown) => {
        new Notice(`YT Free: ${String(err)}`);
      });
    });

    return card;
  }

  /**
   * One button, in the one shape every state of it shares.
   *
   * Idle, working and done are three layers stacked in a single grid cell and
   * swapped with `visibility`, the border is present in all of them, and the
   * done state is a checkmark with no label. That is the whole no-reflow story:
   * a button cannot change its own size, so pressing one cannot move the card
   * it is on or any card beside it.
   */
  private buildAction(
    host: HTMLElement,
    initial: CardSlot,
    run: (key: CardActionKey, repaint: () => void) => Promise<void> | void,
    repaint: () => void,
  ): CardButton {
    const button = host.createEl("button", {
      cls: "ytfree-card-act",
      attr: { type: "button" },
    });

    const idle = button.createSpan({ cls: "ytfree-card-state ytfree-card-idle" });
    const icon = idle.createSpan({ cls: "ytfree-card-icon" });
    const label = idle.createSpan({ cls: "ytfree-card-label" });

    const busy = button.createSpan({ cls: "ytfree-card-state ytfree-card-busy" });
    busy.createDiv({ cls: "ytfree-card-spinner" });

    const done = button.createSpan({ cls: "ytfree-card-state ytfree-card-done" });
    setIcon(done, "check");

    let painted = "";
    const paint = (slot: CardSlot): void => {
      // Only a real change touches the DOM: a repaint runs on every action, and
      // re-rendering an icon that has not changed is a needless reflow risk.
      const key = `${slot.icon}|${slot.label}|${slot.done}`;
      if (key !== painted) {
        painted = key;
        icon.empty();
        setIcon(icon, slot.icon);
        label.setText(slot.label);
        button.toggleClass("is-done", slot.done);
      }
      button.toggleClass("is-danger", Boolean(slot.danger));
      button.setAttribute("aria-label", slot.label);
      button.setAttribute("title", slot.label);
    };
    paint(initial);

    button.addEventListener("click", (evt) => {
      // The card body is Preview, so every button has to stop its own click
      // from also being a tap on the card.
      evt.stopPropagation();
      if (button.hasClass("is-busy")) return;
      button.addClass("is-busy");
      void Promise.resolve(run(initial.key, repaint)).then(
        () => {
          button.removeClass("is-busy");
          repaint();
        },
        (err: unknown) => {
          button.removeClass("is-busy");
          repaint();
          new Notice(`YT Free: ${String(err)}`);
        },
      );
    });

    return { paint };
  }

  /** Where playback got to on this video, in seconds. Zero if it has not. */
  private resumeAt(videoId: string): number {
    return this.progressFor?.(videoId) ?? 0;
  }

  /**
   * A card the current list no longer contains goes, now rather than at the next
   * refresh.
   *
   * The Inbox is "not opened, not hidden", so opening a video takes it out of
   * that list — but until this, only the tick on the card changed and the row
   * stayed until something else redrew the view. BarkernotBob's report is the obvious
   * consequence: the hub in a side pane still showed everything he had worked
   * through.
   *
   * This does move the rows below it, which the Hide button already does for the
   * same reason. It is not the case the no-reflow rule is about: the click that
   * triggers it has just opened a note, so the thing under your finger is the
   * note, not the list.
   */
  private dropIfFiltered(videoId: string): void {
    const card = this.cards.get(videoId);
    if (!card) return;
    if (this.currentItems().some((item) => item.videoId === videoId)) return;

    card.remove();
    this.cards.delete(videoId);
    // The empty state is part of the list, so an emptied list is re-rendered
    // rather than left blank.
    if (this.cards.size === 0) this.renderList();
    this.renderStatus();
  }

  /**
   * The phone byline: who made it, and when.
   *
   * Two spans, not one string. The channel is the only part allowed to
   * ellipsize — it is the one you still recognise from its first two thirds —
   * and the age is a fixed-width track beside it that nothing can eat into. A
   * single joined string could only ever cut the end, which is the age.
   */
  private renderPhoneSub(host: HTMLElement, channel: string, trailing: string): void {
    const sub = host.createDiv({ cls: "ytfree-hub-sub" });
    sub.createSpan({ cls: "ytfree-hub-sub-name", text: channel });
    // Created either way — an empty span reserves the same nothing — so an item
    // with no date is the same row minus one fact.
    sub.createSpan({
      cls: "ytfree-hub-sub-age",
      text: trailing ? (channel ? `· ${trailing}` : trailing) : "",
    });
  }

  /**
   * Preview: everything the card had no room for, in a modal.
   *
   * A modal rather than an inline expansion or a second pane, and that is what
   * keeps the list's scroll position — the list never unmounts, so previewing
   * eight results in a row costs no re-scroll, which is also what makes the
   * paging above safe.
   *
   * It plays, since 024. The full engine minus the note-coupled features —
   * Smart Speed, silence skipping, seek and speed all work; transcript,
   * timestamp capture and pinning do not, and withholding those is what keeps
   * Watch worth pressing.
   */
  private openPreview(videoId: string, repaintCard: () => void): void {
    const item = this.store.itemFor(videoId);
    const result = this.searchResults.find((entry) => entry.videoId === videoId) ?? null;
    if (!item && !result) return;

    const facts = (): CardFacts => ({
      inHub: this.store.hasItem(videoId),
      noteExists: this.store.hasNote(videoId),
    });

    new PreviewModal(this.app, {
      videoId,
      mount: this.mountPreview,
      title: item?.title ?? result?.title ?? "",
      channel: item?.channelTitle ?? result?.channelTitle ?? "",
      facts: [
        item ? formatDuration(item.durationSeconds) : (result?.duration ?? ""),
        result ? formatViews(result.views) : "",
        item ? relativeAge(item.published, new Date()) : (result?.publishedText ?? ""),
      ].filter(Boolean),
      // A search result carries no description — search never returns one — so
      // the modal fetches it once, on open, and says so until it lands.
      description: item?.description ?? "",
      fetchDescription: item?.description
        ? null
        : () => fetchVideoDetails(videoId).then((details) => details.description),
      fetchTranscript: () => fetchTranscriptCues(videoId, this.settings().transcriptLanguage),
      share: this.shareMenu,
      slots: () => (item ? hubSlots(facts()) : searchSlots(facts())),
      run: async (key, repaint) => {
        // Re-looked-up: the modal outlives the card that opened it, and a poll
        // can replace the item object while it is open.
        const live = this.store.itemFor(videoId);
        if (live) await this.runItemAction(key, live, repaint);
        else if (result) await this.runResultAction(key, result, repaint);
        repaintCard();
      },
    }).open();
  }
}

/**
 * The preview sheet. Same four buttons at the foot as the card that opened it,
 * so a decision can be made from in here without dismissing first.
 */
interface PreviewSpec {
  videoId: string;
  /** Absent, the sheet is information only — see `PreviewMount`. */
  mount: PreviewMount | null;
  title: string;
  channel: string;
  /** Length, views, age — whichever of them this video has. */
  facts: string[];
  description: string;
  /** Fetches the description for a video that arrived without one. */
  fetchDescription: (() => Promise<string>) | null;
  /** Fetches the transcript. Started on open, not on expand — see `mountTranscript`. */
  fetchTranscript: (() => Promise<Cue[]>) | null;
  /** Opens the share menu. Null — no plugin behind the view — and no Share is drawn. */
  share: ShareMenu | null;
  slots: () => CardSlot[];
  run: (key: CardActionKey, repaint: () => void) => Promise<void>;
}

/** How often the transcript re-checks which line is being spoken. */
const TRANSCRIPT_TICK_MS = 400;

class PreviewModal extends Modal {
  /** The live player, once it has one. */
  private player: PreviewHandle | null = null;
  /** Set by `onClose`, so a mount that lands after the sheet is gone is dropped. */
  private closed = false;
  /** The `setInterval` that lights the spoken line, while the transcript is open. */
  private tick: number | null = null;
  /** One row per cue, in cue order, so the highlight is an index and not a search. */
  private cueRows: HTMLElement[] = [];
  private cues: Cue[] = [];
  private litRow = -1;

  constructor(
    app: App,
    private spec: PreviewSpec,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl } = this;
    modalEl.addClass("ytfree-preview-modal");
    contentEl.empty();

    this.mountPlayer(contentEl);
    contentEl.createDiv({ cls: "ytfree-preview-title", text: this.spec.title });
    contentEl.createDiv({
      cls: "ytfree-preview-facts",
      text: [this.spec.channel, ...this.spec.facts].filter(Boolean).join(" · "),
    });

    const body = contentEl.createDiv({
      cls: "ytfree-preview-description",
      text: this.spec.description || (this.spec.fetchDescription ? "Loading…" : "No description."),
    });
    if (this.spec.fetchDescription) {
      void this.spec.fetchDescription().then(
        (text) => body.setText(text || "No description."),
        () => body.setText("No description."),
      );
    }

    this.mountTranscript(contentEl);

    const actions = contentEl.createDiv({ cls: "ytfree-card-actions ytfree-preview-actions" });
    const buttons = new Map<CardActionKey, HTMLButtonElement>();
    const repaint = (): void => {
      for (const slot of this.spec.slots()) {
        const button = buttons.get(slot.key);
        if (!button) continue;
        button.toggleClass("is-done", slot.done);
        button.setAttribute("aria-label", slot.label);
        button.setAttribute("title", slot.label);
        const label = button.querySelector(".ytfree-card-label");
        if (label) label.textContent = slot.label;
        const icon = button.querySelector<HTMLElement>(".ytfree-card-icon");
        if (icon) {
          icon.empty();
          setIcon(icon, slot.icon);
        }
      }
    };

    for (const slot of this.spec.slots()) {
      // Preview is what you are already looking at, so it is not offered again.
      if (slot.key === "preview") continue;
      const button = actions.createEl("button", {
        cls: "ytfree-card-act",
        attr: { type: "button" },
      });
      button.toggleClass("is-danger", Boolean(slot.danger));
      const idle = button.createSpan({ cls: "ytfree-card-state ytfree-card-idle" });
      idle.createSpan({ cls: "ytfree-card-icon" });
      idle.createSpan({ cls: "ytfree-card-label" });
      const busy = button.createSpan({ cls: "ytfree-card-state ytfree-card-busy" });
      busy.createDiv({ cls: "ytfree-card-spinner" });
      setIcon(button.createSpan({ cls: "ytfree-card-state ytfree-card-done" }), "check");
      buttons.set(slot.key, button);

      button.addEventListener("click", () => {
        if (button.hasClass("is-busy")) return;
        button.addClass("is-busy");
        // Watch closes *first*, and that ordering is the whole of "one player
        // at a time": closing tears this player down, and tearing it down is
        // what writes the position the note's player is about to read. Run it
        // the other way round and the note opens against a preview that is
        // still playing, at the position the preview had five seconds ago.
        if (slot.key === "watch") this.close();
        void this.spec.run(slot.key, repaint).then(
          () => {
            button.removeClass("is-busy");
            repaint();
            // Remove has just taken the video out of the list it was in, so
            // there is nothing here left worth reading either.
            if (slot.key === "remove") this.close();
          },
          (err: unknown) => {
            button.removeClass("is-busy");
            repaint();
            new Notice(`YT Free: ${String(err)}`);
          },
        );
      });
    }
    repaint();
  }

  /**
   * The player, in a box that is the right size before it holds anything.
   *
   * The box is a fixed 16:9 slot at the top of the sheet, drawn whether the
   * stream resolves or not: a player that appeared a second after the sheet did
   * would push the title, the facts and the four buttons down the screen just
   * as you reached for one of them.
   */
  private mountPlayer(contentEl: HTMLElement): void {
    if (!this.spec.mount) return;
    const stage = contentEl.createDiv({ cls: "ytfree-preview-player" });
    void this.spec.mount(stage, this.spec.videoId).then(
      (handle) => {
        // Dismissed while the stream was resolving. Nobody will call the
        // teardown later, so it is called now — otherwise a sheet closed during
        // a slow resolve leaves a stream running for the rest of the session.
        if (this.closed) handle.destroy();
        else this.player = handle;
      },
      (err: unknown) => {
        console.error("YT Free: preview player could not be built.", err);
        stage.setText("This video could not be played here.");
        stage.addClass("ytfree-preview-player-failed");
      },
    );
  }

  /**
   * The transcript, under the description.
   *
   * **Fetched on open, shown on demand.** The two are deliberately not the same
   * event: a transcript is two round trips and it is not what the sheet is for,
   * so it must not be something you press a button and then wait for. It starts
   * the moment the sheet does and lands while the stream is still resolving, so
   * by the time anyone wants it, it is already there.
   *
   * The header is a full-width row that says the same thing at the same size in
   * both states — only the chevron and the body's visibility change — so
   * opening the transcript never moves the buttons under the pointer.
   */
  private mountTranscript(contentEl: HTMLElement): void {
    if (!this.spec.fetchTranscript) return;

    const section = contentEl.createDiv({ cls: "ytfree-preview-transcript" });
    const header = section.createEl("button", {
      cls: "ytfree-preview-transcript-head",
      attr: { type: "button", "aria-expanded": "false" },
    });
    const chevron = header.createSpan({ cls: "ytfree-preview-transcript-chevron" });
    setIcon(chevron, "chevron-right");
    const label = header.createSpan({
      cls: "ytfree-preview-transcript-label",
      text: "Transcript",
    });
    const body = section.createDiv({ cls: "ytfree-preview-transcript-body" });

    header.addEventListener("click", () => {
      const open = section.hasClass("is-open");
      section.toggleClass("is-open", !open);
      header.setAttribute("aria-expanded", String(!open));
      setIcon(chevron, open ? "chevron-right" : "chevron-down");
      // The tick only runs while anyone can see what it lights up.
      if (open) this.stopTicking();
      else this.startTicking();
    });

    void this.spec.fetchTranscript().then(
      (cues) => {
        if (this.closed) return;
        this.cues = cues;
        if (cues.length === 0) {
          label.setText("Transcript — none for this video");
          header.setAttribute("disabled", "true");
          return;
        }
        label.setText(`Transcript · ${cues.length} lines`);
        this.fillTranscript(body, cues);
        if (section.hasClass("is-open")) this.startTicking();
      },
      (err: unknown) => {
        console.error("YT Free: preview transcript could not be fetched.", err);
        if (this.closed) return;
        label.setText("Transcript — could not be fetched");
        header.setAttribute("disabled", "true");
      },
    );
  }

  /** One row per cue: a timestamp that seeks, and the words that were said. */
  private fillTranscript(body: HTMLElement, cues: Cue[]): void {
    body.empty();
    this.cueRows = cues.map((cue) => {
      const row = body.createEl("button", {
        cls: "ytfree-preview-cue",
        attr: { type: "button" },
      });
      row.createSpan({ cls: "ytfree-preview-cue-time", text: formatDuration(cue.seconds) });
      row.createSpan({ cls: "ytfree-preview-cue-text", text: cue.text });
      row.addEventListener("click", () => this.player?.seek(cue.seconds));
      return row;
    });
  }

  /**
   * Light the line being spoken, and keep it in view.
   *
   * Polled rather than driven by `timeupdate`, because the handle the hub holds
   * is deliberately three functions wide — the seam between the hub and the
   * player engine is not a place to grow an event bus for one highlight.
   */
  private startTicking(): void {
    if (this.tick !== null || this.cueRows.length === 0) return;
    const paint = (): void => {
      const at = this.player?.currentTime() ?? 0;
      let index = -1;
      for (let i = 0; i < this.cues.length && this.cues[i].seconds <= at; i++) index = i;
      if (index === this.litRow) return;
      if (this.litRow >= 0) this.cueRows[this.litRow]?.removeClass("is-now");
      this.litRow = index;
      if (index < 0) return;
      const row = this.cueRows[index];
      row.addClass("is-now");
      row.scrollIntoView({ block: "nearest" });
    };
    paint();
    this.tick = window.setInterval(paint, TRANSCRIPT_TICK_MS);
  }

  private stopTicking(): void {
    if (this.tick === null) return;
    window.clearInterval(this.tick);
    this.tick = null;
  }

  onClose(): void {
    this.closed = true;
    this.stopTicking();
    this.player?.destroy();
    this.player = null;
    this.contentEl.empty();
  }
}

/**
 * Getting channels in — a Takeout CSV, or one channel at a time.
 *
 * The CSV is read through the file input's own `text()` rather than a path,
 * because recent Electron no longer exposes `File.path` to the renderer. We
 * only ever wanted the bytes anyway.
 *
 * There is no sync here and there cannot be one: YouTube exposes no supported
 * way to read a subscription list, which is exactly why this is a manual dump.
 */
export class ImportSubscriptionsModal extends Modal {
  constructor(
    app: App,
    private store: SubscriptionsStore,
    private onDone: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Import YouTube subscriptions" });
    contentEl.createEl("p", {
      cls: "ytfree-hub-hint",
      text:
        "Google Takeout → YouTube and YouTube Music → deselect everything except “subscriptions”. " +
        "The export contains subscriptions.csv. Importing again later adds new channels and changes nothing else.",
    });

    // A reserved status line: filling it in must not resize the dialog.
    const status = contentEl.createDiv({ cls: "ytfree-hub-modal-status" });

    const picker = contentEl.createEl("input", { type: "file" });
    picker.accept = ".csv,text/csv";
    picker.addClass("ytfree-hub-file");
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return;
      void file
        .text()
        .then((text) => {
          const parsed = parseSubscriptionsCsv(text);
          if (parsed.length === 0) {
            status.setText("No channel IDs found in that file. Is it subscriptions.csv?");
            return;
          }
          const added = this.store.addChannels(parsed);
          status.setText(
            `${parsed.length} channels in the file — ${added} new, ${parsed.length - added} already here.`,
          );
          this.onDone();
        })
        .catch((err: unknown) => status.setText(`Could not read that file — ${String(err)}`));
    });

    let single = "";
    new Setting(contentEl)
      .setName("Or add one channel")
      .setDesc("A channel URL or a UC… ID. A @handle works too — the ID is read off the page.")
      .addText((text) =>
        text.setPlaceholder("https://www.youtube.com/@channel").onChange((value) => {
          single = value;
        }),
      )
      .addButton((button) =>
        button.setButtonText("Add").onClick(() => {
          void this.addOne(single, status);
        }),
      );

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Done")
        .setCta()
        .onClick(() => this.close()),
    );
  }

  private async addOne(input: string, status: HTMLElement): Promise<void> {
    const text = input.trim();
    if (!text) return;

    let id = parseChannelInput(text);
    if (!id && /youtube\.com/.test(text)) {
      status.setText("Looking up that channel…");
      try {
        const page = await requestUrl({ url: text, throw: true });
        id = extractChannelIdFromHtml(page.text);
      } catch {
        id = null;
      }
    }
    if (!id) {
      status.setText("No channel ID in that. Try the channel's URL, or its UC… ID.");
      return;
    }
    const added = this.store.addChannels([{ id, title: id }]);
    status.setText(added ? "Channel added. It will fill in on the next check." : "Already added.");
    this.onDone();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
