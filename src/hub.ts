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
import type { HubFilter, HubItem, SubscriptionsState } from "./subscriptions";
import {
  buildWatchLaterNote,
  deskSub,
  emptyState,
  extractChannelIdFromHtml,
  hideItem,
  parseChannelInput,
  parseSubscriptionsCsv,
  expireItems,
  feedUrl,
  formatDuration,
  formatViews,
  mergeItems,
  normalizeState,
  parseChannelFeed,
  phoneSub,
  relativeAge,
  restoreItem,
  sanitizeFileName,
  searchResultToItem,
  visibleItems,
} from "./subscriptions";
import { NOTES_HEADING } from "./sections";
import { fetchVideoDetails, searchYouTube } from "./innertube";
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

export interface HubSettings {
  pollMinutes: number;
  expiryDays: number;
  includeShorts: boolean;
  watchLaterFolder: string;
  /** Keep videos the account says were already watched in the Inbox. */
  showWatched: boolean;
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
    try {
      if (await this.app.vault.adapter.exists(this.statePath)) {
        this.state = normalizeState(JSON.parse(await this.app.vault.adapter.read(this.statePath)));
      }
    } catch (err) {
      console.error("YT Free: subscriptions state unreadable, starting empty.", err);
      this.state = emptyState();
    }
  }

  /** Serialized: a poll and a click can both finish inside the same tick. */
  save(): Promise<void> {
    this.saving = this.saving
      .then(() => this.app.vault.adapter.write(this.statePath, JSON.stringify(this.state)))
      .catch((err) => console.error("YT Free: could not write subscriptions state.", err));
    return this.saving;
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
    this.emit();
    void this.save();
  }

  // ----------------------------------------------------------------- poll

  async poll(): Promise<void> {
    if (this.polling) return;
    if (this.state.channels.length === 0) return;
    this.polling = true;
    this.emit();

    const now = new Date();
    try {
      await mapLimit(this.state.channels, 5, async (channel) => {
        try {
          const response = await requestUrl({ url: feedUrl(channel.id), throw: true });
          const feed = parseChannelFeed(response.text);
          // The feed's own title is authoritative; a Takeout export goes stale.
          if (feed.channelTitle) channel.title = feed.channelTitle;
          channel.error = null;
          const merged = mergeItems(this.state.items, channel, feed.entries, now);
          this.state.items = merged.items;
        } catch (err) {
          // Recorded, shown in the hub, and retried next poll. A channel that
          // 404s because it was deleted should be visible, not silently absent.
          channel.error = err instanceof Error ? err.message : String(err);
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
      item.durationSeconds = details.durationSeconds;
      // Free, and it is the thing the hub exists to hold on to: a Watch Later
      // item arrives without one, and a feed item whose video has since fallen
      // out of the 15-entry window can never get one anywhere else.
      if (!item.description && details.description) item.description = details.description;
    });
  }

  // --------------------------------------------------------------- search

  hasItem(videoId: string): boolean {
    return this.state.items.some((item) => item.videoId === videoId);
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
    this.state.items.push(
      searchResultToItem(result, details.description, new Date(), details.durationSeconds),
    );
    this.emit();
    void this.save();
    return "added";
  }

  // ----------------------------------------------------------------- note

  /**
   * Turn an item into a Watch Later note and open it. One click, not two: the
   * click is the only signal the hub needs, so there is no separate save.
   *
   * Re-clicking a kept item opens what is already there. Nothing here ever
   * overwrites a file.
   */
  async openItem(item: HubItem): Promise<void> {
    const existing = item.notePath
      ? this.app.vault.getAbstractFileByPath(item.notePath)
      : null;
    if (existing instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(existing);
      return;
    }

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

    item.state = "kept";
    item.notePath = path;
    this.emit();
    void this.save();

    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
      // A fresh note is for writing, so start the cursor in the Notes section
      // rather than at the top of the frontmatter.
      if (created && leaf.view instanceof MarkdownView) {
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
  }

  /**
   * Remove a video from the hub — which now means hiding it, not deleting it.
   *
   * `hideItem` strips it to a tombstone on the way out; see the note there for
   * why the description goes. The tombstone is what stops the video coming back
   * from a later poll, and what stops a search offering it to you again.
   */
  hide(item: HubItem): void {
    hideItem(item, new Date());
    this.emit();
    void this.save();
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
    restoreItem(item);
    this.emit();
    void this.save();

    if (item.description) return;
    const details = await fetchVideoDetails(item.videoId);
    // Re-checked: a click during the round trip could have hidden it again, and
    // writing a description onto a tombstone would undo the compaction.
    if (details.description && item.state !== "dismissed") {
      item.description = details.description;
      if (item.durationSeconds === undefined) item.durationSeconds = details.durationSeconds;
      void this.save();
    }
  }
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
  /** Results with an add in flight, so a second tap cannot double-add. */
  private adding = new Set<string>();
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
    return "youtube";
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
    setIcon(browse, "youtube");
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
    this.adding.clear();
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
    this.adding.clear();
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
    // in the right half without anything above it being redrawn.
    this.primaryEl = list.createDiv({ cls: "ytfree-hub-results" });
    this.relatedEl = list.createDiv({ cls: "ytfree-hub-results" });

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
   * It looks like a hub card and behaves like nothing else in the plugin: the
   * only thing it can do is add itself. There is no link, no anchor, no
   * `<video>`, and nothing here that a click can turn into playback — see
   * `docs/V1-SCOPE-BROWSE.md`. Browse adds; the hub decides.
   */
  private renderResult(result: SearchResult, now: Date): void {
    const host = this.resultHost(result);
    if (!host) return;
    const card = host.createDiv({ cls: "ytfree-hub-card ytfree-hub-result" });

    const thumb = card.createDiv({ cls: "ytfree-hub-thumb" });
    if (result.thumbnail) {
      const img = thumb.createEl("img");
      img.src = result.thumbnail;
      img.loading = "lazy";
      img.alt = "";
    }
    // Duration is the one thing search knows that a channel feed does not, so
    // it goes where a YouTube reader already looks for it. Created either way,
    // so a missing one leaves the thumbnail exactly the same size.
    thumb.createSpan({ cls: "ytfree-hub-duration", text: result.duration });

    // Same split as a hub card: on a phone the marker is a badge on the
    // thumbnail, because a phone row has no width to spend on a column.
    const badge = this.phone ? thumb.createDiv({ cls: "ytfree-hub-marker" }) : null;

    const meta = card.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: result.title });
    const sub = meta.createDiv({ cls: "ytfree-hub-sub" });
    // A phone row gives the line about 180pt. Three segments do not fit in it,
    // and the view count is the one you never decide on: the duration is
    // already a badge on the thumbnail, and who made it and how old it is are
    // what you scan a result by.
    sub.setText(
      [result.channelTitle, result.publishedText, this.phone ? "" : formatViews(result.views)]
        .filter(Boolean)
        .join(" · "),
    );

    const marker = badge ?? card.createDiv({ cls: "ytfree-hub-marker" });
    this.paintResultMarker(marker, result.videoId);

    card.addEventListener("click", () => this.addResult(result, marker));
  }

  /**
   * Reserved space, filled three ways: addable, adding, already here. Same box
   * whichever it is, so the answer arriving moves nothing.
   */
  private paintResultMarker(marker: HTMLElement, videoId: string): void {
    marker.empty();
    const inHub = this.store.hasItem(videoId);
    const busy = this.adding.has(videoId);
    marker.toggleClass("is-added", inHub);
    marker.toggleClass("is-adding", busy);
    setIcon(marker, busy ? "loader" : inHub ? "check" : "plus");
    marker.setAttribute(
      "aria-label",
      busy ? "Adding…" : inHub ? "In your hub" : "Add to your hub",
    );
    marker.setAttribute("title", busy ? "Adding…" : inHub ? "In your hub" : "Add to your hub");
  }

  private addResult(result: SearchResult, marker: HTMLElement): void {
    if (this.store.hasItem(result.videoId) || this.adding.has(result.videoId)) return;
    this.adding.add(result.videoId);
    this.paintResultMarker(marker, result.videoId);

    void this.store
      .addSearchResult(result)
      .catch((err: unknown) => {
        new Notice(`YT Free: could not add that video — ${String(err)}`);
      })
      .then(() => {
        this.adding.delete(result.videoId);
        this.paintResultMarker(marker, result.videoId);
        this.renderStatus();
      });
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
    for (const item of items) this.renderCard(item, now);
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
   * The two platforms build different cards out of the same parts. A desktop
   * card is a row: thumbnail, title, one line of facts, a marker column and a
   * dismiss column, 90px tall. A phone card is the same row a size larger — a
   * 128×72 thumbnail with the length on it, two lines of title, and
   * `channel · age` — beside a dismiss column wide enough to hit with a thumb.
   */
  private renderCard(item: HubItem, now: Date): void {
    const list = this.listEl;
    if (!list) return;
    const card = list.createDiv({ cls: "ytfree-hub-card" });
    this.cards.set(item.videoId, card);

    // The phone's card is a grid — content in one column, the dismiss target in
    // the other — so the content hangs off a wrapper rather than off the card.
    const row = this.phone ? card.createDiv({ cls: "ytfree-hub-row" }) : card;

    const thumb = row.createDiv({ cls: "ytfree-hub-thumb" });
    if (item.thumbnail) {
      const img = thumb.createEl("img");
      img.src = item.thumbnail;
      img.loading = "lazy";
      img.alt = "";
    }

    // Bottom-right of the thumbnail, exactly where a search result puts its
    // own: how long it runs, and "Short" only when there is no length to state
    // — a 45-second video says 0:45, which is the same fact more precisely.
    // Created either way, so a video with neither leaves the card as it is.
    if (this.phone) {
      const length = formatDuration(item.durationSeconds);
      thumb.createSpan({
        cls: "ytfree-hub-duration",
        text: length || (item.isShort ? "Short" : ""),
      });
    }

    // A phone row has no width to spend on a marker column — the title is what
    // that width is for. The badge sits on the thumbnail instead, absolutely
    // positioned, so it still costs no layout when it appears.
    const marker = this.phone
      ? thumb.createDiv({ cls: "ytfree-hub-marker" })
      : null;

    const meta = row.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: item.title });
    const sub = meta.createDiv({ cls: "ytfree-hub-sub" });
    sub.setText(this.phone ? phoneSub(item, now) : deskSub(item, now));
    card.toggleClass("is-watched", Boolean(item.watched));

    // Fixed-width column, filled or not, so marking an item Kept moves nothing.
    const stateMarker = marker ?? row.createDiv({ cls: "ytfree-hub-marker" });
    this.paintMarker(stateMarker, item);

    const dismiss = (this.phone ? card : row).createDiv({ cls: "ytfree-hub-dismiss" });
    const button = new ButtonComponent(dismiss)
      .setIcon("x")
      .setTooltip("Hide — find it again under Hidden")
      .onClick((evt) => {
        evt.stopPropagation();
        this.store.hide(item);
        card.remove();
        this.cards.delete(item.videoId);
        // The empty state is part of the list, so an emptied list is re-rendered
        // rather than left blank.
        if (this.cards.size === 0) this.renderList();
        this.renderStatus();
      });
    button.buttonEl.addClass("ytfree-hub-icon-button");

    card.addEventListener("click", () => {
      void this.store.openItem(item).then(
        () => this.paintMarker(stateMarker, item),
        (err: unknown) => new Notice(`YT Free: could not create the note — ${String(err)}`),
      );
    });
  }

  private paintMarker(marker: HTMLElement, item: HubItem): void {
    marker.empty();
    if (item.state === "kept") setIcon(marker, "check");
    else if (item.state === "dismissed") setIcon(marker, "minus");
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
