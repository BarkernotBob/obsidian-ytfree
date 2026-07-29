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
  emptyState,
  extractChannelIdFromHtml,
  parseChannelInput,
  parseSubscriptionsCsv,
  expireItems,
  feedUrl,
  formatViews,
  mergeItems,
  normalizeState,
  parseChannelFeed,
  relativeAge,
  sanitizeFileName,
  searchResultToItem,
  visibleItems,
} from "./subscriptions";
import { fetchDescription, searchYouTube } from "./innertube";
import type { SearchResult } from "./search";

export const HUB_VIEW_TYPE = "ytfree-hub";

export interface HubSettings {
  pollMinutes: number;
  expiryDays: number;
  includeShorts: boolean;
  watchLaterFolder: string;
  /** Keep videos the account says were already watched in the New list. */
  showWatched: boolean;
}

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

      this.state.lastPolledAt = now.toISOString();
    } finally {
      this.polling = false;
      this.emit();
      await this.save();
    }
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
    const description = await fetchDescription(result.videoId);
    // Checked again: the fetch is a round trip, and a poll or a second click
    // can land inside it. Never a duplicate.
    if (this.hasItem(result.videoId)) return "exists";
    this.state.items.push(searchResultToItem(result, description, new Date()));
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
          if (editor.getLine(i) === "## Notes") {
            editor.setCursor({ line: i + 1, ch: 0 });
            editor.focus();
            break;
          }
        }
      }
    }
  }

  dismiss(item: HubItem): void {
    item.state = item.state === "dismissed" ? "new" : "dismissed";
    this.emit();
    void this.save();
  }
}

/**
 * The hub view.
 *
 * Redraws are explicit and never triggered by a click on an item. Clicking a
 * video in the New list makes it Kept, which under the filter would remove it
 * from the list and pull everything below it upward — so instead the card stays
 * where it is and only its marker changes. The list re-filters on the next
 * refresh, poll, or filter change.
 */
export class HubView extends ItemView {
  private filter: HubFilter = "new";
  private channelFilter: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private listEl!: HTMLElement;
  private channelsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  /** Cards on screen right now, so a click can update one in place. */
  private cards = new Map<string, HTMLElement>();

  /**
   * Search mode. `searchQuery` is null whenever the hub is showing its own
   * items, which is the one flag everything else reads: the list, the status
   * line, and what clearing the box goes back to. The filter and the channel
   * selection are untouched by any of this, so leaving search restores exactly
   * the hub you left.
   */
  private searchQuery: string | null = null;
  private searchResults: SearchResult[] = [];
  private searchContinuation: string | null = null;
  private searchState: "idle" | "loading" | "error" = "idle";
  private searchError = "";
  private searchInputEl: HTMLInputElement | null = null;
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

    const header = root.createDiv({ cls: "ytfree-hub-header" });

    // Phone: the filters move into the collapsible menu and the header carries
    // only the disclosure that says what is currently selected.
    if (this.phone) this.buildDisclosure(header);
    else this.buildFilters(header);

    const actions = header.createDiv({ cls: "ytfree-hub-actions" });
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

    this.buildSearch(root);
    this.statusEl = root.createDiv({ cls: "ytfree-hub-status" });

    const body = root.createDiv({ cls: "ytfree-hub-body" });
    if (this.phone) this.buildPhoneBody(body);
    else {
      this.channelsEl = body.createDiv({ cls: "ytfree-hub-channels" });
      this.listEl = body.createDiv({ cls: "ytfree-hub-list" });
    }
  }

  /**
   * The search box — its own row, above the status line and below whatever the
   * header is showing on this platform.
   *
   * A row of its own rather than a slot in the header because the header is
   * already the tightest thing on a phone, and because the box is the entrance
   * to a different mode: it should read as the top of the list it replaces.
   */
  private buildSearch(root: HTMLElement): void {
    const row = root.createDiv({ cls: "ytfree-hub-search" });

    const input = row.createEl("input", {
      cls: "ytfree-hub-search-input",
      // `search` gives iOS a Search key and both platforms a native clear
      // control, which fires `input` like any other edit — so clearing by hand
      // and clearing with the × take the same path out of search mode.
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

    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.runSearch(input.value);
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        this.exitSearch();
      }
    });
    // Emptying the box is the way back, and it has to work however the box was
    // emptied — backspace, the native ×, or a paste of nothing.
    input.addEventListener("input", () => {
      if (input.value.trim() === "" && this.searchQuery !== null) this.exitSearch();
    });

    const go = row.createEl("button", {
      cls: "ytfree-hub-icon-button",
      attr: { type: "button", "aria-label": "Search YouTube", title: "Search YouTube" },
    });
    setIcon(go, "search");
    go.addEventListener("click", () => this.runSearch(input.value));
  }

  /** The three filter chips. Same markup either side; only the host differs. */
  private buildFilters(host: HTMLElement): void {
    const filters = host.createDiv({ cls: "ytfree-hub-filters" });
    const options: Array<[HubFilter, string]> = [
      ["new", "New"],
      ["all", "All"],
      ["kept", "Kept"],
    ];
    for (const [value, label] of options) {
      const button = filters.createEl("button", { text: label, cls: "ytfree-hub-filter" });
      button.toggleClass("is-active", this.filter === value);
      button.addEventListener("click", () => {
        this.filter = value;
        // The filters describe the hub's own items, so choosing one is a way
        // out of search — and the filter you chose is the one you land on.
        this.clearSearch();
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
    const filterLabel = this.filter === "new" ? "New" : this.filter === "kept" ? "Kept" : "All";
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

    // In search mode the status line belongs to the search, not to the hub:
    // the counts underneath are about a list you are not looking at.
    if (this.searchQuery !== null) {
      if (this.searchState === "error") {
        this.statusEl.setText(`Search failed — ${this.searchError}`);
      } else if (this.searchState === "loading" && this.searchResults.length === 0) {
        this.statusEl.setText(`Searching for “${this.searchQuery}”…`);
      } else if (this.searchResults.length === 0) {
        this.statusEl.setText(`Nothing found for “${this.searchQuery}”.`);
      } else {
        this.statusEl.setText(
          `${this.searchResults.length} results for “${this.searchQuery}” · click one to add it to your hub`,
        );
      }
      return;
    }

    const { channels, items, lastPolledAt } = this.store.state;
    const shown = this.currentItems().length;
    const parts: string[] = [];
    if (this.store.polling) parts.push("Checking channels…");
    else if (channels.length === 0) parts.push("No channels yet — import your subscriptions.");
    else parts.push(`${shown} of ${items.length} videos · ${channels.length} channels`);
    if (lastPolledAt && !this.store.polling) {
      parts.push(`checked ${relativeAge(lastPolledAt, new Date())}`);
    }
    this.statusEl.setText(parts.join(" · "));
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
    this.clearSearch();
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
    });
  }

  // --------------------------------------------------------------- search

  /**
   * Leave search mode without redrawing. The state is dropped and the box is
   * emptied; the filter and the channel selection are deliberately not touched,
   * because they are what you go back to.
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
    this.adding.clear();
    this.renderList();
    this.renderStatus();

    void searchYouTube(text)
      .then(
        (page) => {
          if (token !== this.searchToken) return;
          this.searchResults = page.results;
          this.searchContinuation = page.continuation;
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

    void searchYouTube(query, continuation)
      .then(
        (page) => {
          if (token !== this.searchToken) return;
          const known = new Set(this.searchResults.map((result) => result.videoId));
          const fresh = page.results.filter((result) => !known.has(result.videoId));
          this.searchResults = [...this.searchResults, ...fresh];
          this.searchContinuation = page.continuation;
          this.searchState = "idle";
          const now = new Date();
          for (const result of fresh) this.renderResult(result, now, button);
          button.setText("More results");
          // The end of the road: YouTube stopped offering a token, or answered
          // with nothing new. Either way there is no page after this one.
          if (!page.continuation || fresh.length === 0) button.remove();
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
    this.listEl.empty();
    this.cards.clear();

    if (this.searchState === "error") {
      this.listEl.createDiv({
        cls: "ytfree-hub-empty",
        text: `Search failed — ${this.searchError}`,
      });
      return;
    }
    if (this.searchState === "loading" && this.searchResults.length === 0) {
      this.listEl.createDiv({ cls: "ytfree-hub-empty", text: "Searching YouTube…" });
      return;
    }
    if (this.searchResults.length === 0) {
      this.listEl.createDiv({ cls: "ytfree-hub-empty", text: "No results." });
      return;
    }

    const now = new Date();
    for (const result of this.searchResults) this.renderResult(result, now, null);

    if (this.searchContinuation) {
      const more = this.listEl.createEl("button", {
        cls: "ytfree-hub-more",
        text: "More results",
        attr: { type: "button" },
      });
      more.addEventListener("click", () => this.loadMore(more));
    }
  }

  /**
   * A search result card.
   *
   * It looks like a hub card and behaves like nothing else in the plugin: the
   * only thing it can do is add itself. There is no link, no anchor, no
   * `<video>`, and nothing here that a click can turn into playback — see
   * `docs/V1-SCOPE-BROWSE.md`. Browse adds; the hub decides.
   */
  private renderResult(result: SearchResult, now: Date, before: HTMLElement | null): void {
    const card = this.listEl.createDiv({ cls: "ytfree-hub-card ytfree-hub-result" });
    if (before) this.listEl.insertBefore(card, before);

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
    sub.setText(
      [result.channelTitle, result.publishedText, formatViews(result.views)]
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
    if (!this.listEl) return;
    if (this.searchQuery !== null) {
      this.renderSearch();
      return;
    }
    this.listEl.empty();
    this.cards.clear();

    const items = this.currentItems();
    if (items.length === 0) {
      this.listEl.createDiv({
        cls: "ytfree-hub-empty",
        text:
          this.store.state.channels.length === 0
            ? "Run “YT Free: Import YouTube subscriptions” to get started."
            : "Nothing here. Try the All filter, or check for new videos.",
      });
      return;
    }

    const now = new Date();
    for (const item of items) this.renderCard(item, now);
  }

  private renderCard(item: HubItem, now: Date): void {
    const card = this.listEl.createDiv({ cls: "ytfree-hub-card" });
    this.cards.set(item.videoId, card);

    const thumb = card.createDiv({ cls: "ytfree-hub-thumb" });
    if (item.thumbnail) {
      const img = thumb.createEl("img");
      img.src = item.thumbnail;
      img.loading = "lazy";
      img.alt = "";
    }

    // A phone row has no width to spend on a marker column — the title is what
    // that width is for. The badge sits on the thumbnail instead, absolutely
    // positioned, so it still costs no layout when it appears.
    const marker = this.phone
      ? thumb.createDiv({ cls: "ytfree-hub-marker" })
      : null;

    const meta = card.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: item.title });
    const sub = meta.createDiv({ cls: "ytfree-hub-sub" });
    const bits = [item.channelTitle, relativeAge(item.published, now), formatViews(item.views)];
    if (item.isShort) bits.push("Short");
    // Where it came from, and whether it is already seen. A Watch Later item
    // has no publish date, so without the label it looks like a bug.
    if (item.origin === "watchlater" || item.origin === "both") bits.push("Watch Later");
    // A search item carries no publish date either, for the same reason: say
    // where it came from and the missing age reads as a fact, not a bug.
    if (item.origin === "search") bits.push("Search");
    if (item.watched) bits.push("Watched");
    sub.setText(bits.filter(Boolean).join(" · "));
    card.toggleClass("is-watched", Boolean(item.watched));

    // Fixed-width column, filled or not, so marking an item Kept moves nothing.
    const stateMarker = marker ?? card.createDiv({ cls: "ytfree-hub-marker" });
    this.paintMarker(stateMarker, item);

    const dismiss = card.createDiv({ cls: "ytfree-hub-dismiss" });
    const button = new ButtonComponent(dismiss)
      .setIcon("x")
      .setTooltip("Remove")
      .onClick((evt) => {
        evt.stopPropagation();
        this.store.dismiss(item);
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
