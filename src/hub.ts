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
  visibleItems,
} from "./subscriptions";

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

    const header = root.createDiv({ cls: "ytfree-hub-header" });
    const filters = header.createDiv({ cls: "ytfree-hub-filters" });
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
        for (const el of Array.from(filters.children)) {
          el.toggleClass("is-active", el === button);
        }
        this.renderList();
        this.renderStatus();
      });
    }

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

    this.statusEl = root.createDiv({ cls: "ytfree-hub-status" });

    const body = root.createDiv({ cls: "ytfree-hub-body" });
    this.channelsEl = body.createDiv({ cls: "ytfree-hub-channels" });
    this.listEl = body.createDiv({ cls: "ytfree-hub-list" });
  }

  renderAll(): void {
    this.renderStatus();
    this.renderChannels();
    this.renderList();
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
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
    this.renderChannels();
    this.renderList();
    this.renderStatus();
  }

  private currentItems(): HubItem[] {
    return visibleItems(this.store.state.items, {
      filter: this.filter,
      channelId: this.channelFilter,
      includeShorts: this.settings().includeShorts,
      showWatched: this.settings().showWatched,
    });
  }

  private renderList(): void {
    if (!this.listEl) return;
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

    const meta = card.createDiv({ cls: "ytfree-hub-meta" });
    meta.createDiv({ cls: "ytfree-hub-title", text: item.title });
    const sub = meta.createDiv({ cls: "ytfree-hub-sub" });
    const bits = [item.channelTitle, relativeAge(item.published, now), formatViews(item.views)];
    if (item.isShort) bits.push("Short");
    // Where it came from, and whether it is already seen. A Watch Later item
    // has no publish date, so without the label it looks like a bug.
    if (item.origin === "watchlater" || item.origin === "both") bits.push("Watch Later");
    if (item.watched) bits.push("Watched");
    sub.setText(bits.filter(Boolean).join(" · "));
    card.toggleClass("is-watched", Boolean(item.watched));

    // Fixed-width column, filled or not, so marking an item Kept moves nothing.
    const marker = card.createDiv({ cls: "ytfree-hub-marker" });
    this.paintMarker(marker, item);

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
        () => this.paintMarker(marker, item),
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
