/**
 * A JSON file that more than one device writes through a file-sync service.
 *
 * `subscriptions.json` and `progress.json` (and `history.json`, GitHub #48) all
 * share one hazard: a sync service — iCloud, Obsidian Sync, Google Drive,
 * Dropbox, Syncthing — replaces whole files. When two devices both write before
 * either has received the other's copy, one copy wins and the other is dropped,
 * or is set aside as a conflict copy nobody reads. Merging on every save cannot
 * help with that, because the device that wrote second never saw the first.
 *
 * What this adds on top of merge-on-save (docs/V1-SCOPE-SYNC.md):
 *
 * 1. **Write back what the file is missing.** Every read merges the file into
 *    memory, and if the result *means* something the file does not, this device
 *    saves. A decision lost to a collision is re-sent by the device that still
 *    has it, instead of living only in that device's memory.
 * 2. **A device-local copy.** Every save first puts the state in storage that is
 *    not synced, and `load` merges it back in — so an app the OS killed before
 *    its write survived still has the decision when it comes back.
 * 3. **Conflict copies** are merged in and then deleted, once a write that
 *    contains them has landed.
 * 4. **No write over a file that could not be read**, and **no write that would
 *    not change what the file means.**
 *
 * The file I/O is injected, so the tests run two devices against a simulated
 * sync service that loses writes, delivers late and gets killed.
 */

/** The slice of Obsidian's `DataAdapter` this needs. */
export interface SyncDisk {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size?: number } | null>;
  list(folder: string): Promise<{ files: string[] }>;
  remove(path: string): Promise<void>;
}

/** Device-local storage that is never synced — `App.saveLocalStorage` in the app. */
export interface LocalCopy {
  read(): string | null;
  write(value: string): void;
}

/** The rules for one file's contents. All pure. */
export interface SyncCodec<T> {
  empty(): T;
  /** Trust nothing: the file is synced, hand-editable and sometimes truncated. */
  parse(raw: unknown): T;
  /** Must be commutative in meaning, or two devices rewrite the file forever. */
  merge(mine: T, theirs: T): T;
}

export type FileRead<T> =
  | { kind: "state"; state: T }
  | { kind: "absent" }
  | { kind: "unreadable" };

export interface SaveOutcome<T> {
  /** The file now holds everything this device knew — written, or already there. */
  landed: boolean;
  /** Whether a write actually happened. */
  wrote: boolean;
  /** What was in the file before the merge, or null for none / unread. */
  disk: T | null;
}

/** How many times a save re-reads an unreadable file before giving up this attempt. */
export const READ_ATTEMPTS = 3;
export const READ_BACKOFF_MS = [150, 600];

/**
 * The least time between two write-backs caused by a read.
 *
 * Belt and braces against a merge that turns out not to be commutative: two
 * devices that disagree about what a merge means would otherwise rewrite the
 * file at every refresh. The tests prove the merges converge; this caps the
 * cost if a future change breaks that.
 */
export const WRITE_BACK_GAP_MS = 15_000;

/**
 * The gap doubles each time a write-back is owed again straight after one, up
 * to this. Two devices whose writes keep crossing in flight — a slow service,
 * both writing — otherwise re-send on the same beat forever and each keeps
 * knocking the other's copy out. Waiting longer than the round trip lets one
 * copy arrive whole. Reset as soon as a read finds nothing owed.
 */
export const WRITE_BACK_MAX_GAP_MS = 5 * 60_000;

export interface SyncedFileOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 0..1, for the jitter on write-back backoff. */
  random?: () => number;
  /** Off only in the test that proves the simulation reproduces the bug. */
  writeBack?: boolean;
}

/**
 * A value as a string that ignores key order and array order.
 *
 * Every list these files hold is a set keyed by video or channel ID, and merges
 * append in whichever order they met things — so two files that mean the same
 * thing are rarely the same text. Comparing this instead is what lets a device
 * skip a write that would change nothing, and is what stops two devices
 * rewriting the file back and forth over an ordering difference.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The conflict copies sync services leave next to `name`, in `files`.
 *
 * Kept narrow on purpose: these get deleted once merged, so a pattern that also
 * matched a file the user made would be a data-loss bug. Covers
 * `subscriptions 2.json` (iCloud on a Mac), `subscriptions (1).json` (Google
 * Drive), `subscriptions (Mac's conflicted copy 2026-11-09).json` (Dropbox)
 * and `subscriptions.sync-conflict-20261109-101010-ABCDEFG.json` (Syncthing).
 */
export function conflictCopies(path: string, files: readonly string[]): string[] {
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(folder.length);
  const dot = name.lastIndexOf(".");
  const stem = escape(dot > 0 ? name.slice(0, dot) : name);
  const ext = escape(dot > 0 ? name.slice(dot) : "");
  const pattern = new RegExp(
    `^${stem}(?: \\d{1,3}| \\(\\d{1,3}\\)| \\([^()/]*conflicted copy[^()/]*\\)|\\.sync-conflict-[A-Za-z0-9-]+)${ext}$`,
  );
  return files.filter((file) => {
    if (!file.startsWith(folder)) return false;
    const base = file.slice(folder.length);
    return !base.includes("/") && pattern.test(base);
  });
}

function stamp(stat: { mtime: number; size?: number } | null): string {
  return stat ? `${stat.mtime}:${stat.size ?? ""}` : "";
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SyncedFile<T> {
  state: T;
  /**
   * mtime and size of the last copy of the file this device successfully read
   * or wrote. Only a read that answered may advance it (issue 034). Size too,
   * because a sync service may stamp a downloaded copy with a time that happens
   * to match ours.
   */
  private diskTime = "";
  private saving: Promise<SaveOutcome<T>> = Promise.resolve({ landed: false, wrote: false, disk: null });
  private lastWriteBack = -Infinity;
  /** A read showed the file missing something, and the write-back has not happened yet. */
  private owed = false;

  private disk: SyncDisk;
  readonly path: string;
  private codec: SyncCodec<T>;
  private local: LocalCopy | null;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  /** Off only in the test that proves the simulation reproduces the bug. */
  private writeBack: boolean;

  private random: () => number;
  /** The current write-back gap; see `WRITE_BACK_MAX_GAP_MS`. */
  private gap = WRITE_BACK_GAP_MS;

  constructor(
    disk: SyncDisk,
    path: string,
    codec: SyncCodec<T>,
    local: LocalCopy | null,
    options: SyncedFileOptions = {},
  ) {
    this.disk = disk;
    this.path = path;
    this.codec = codec;
    this.local = local;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => globalThis.setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.writeBack = options.writeBack ?? true;
    this.state = codec.empty();
  }

  /**
   * Start from the file, plus whatever this device had saved locally.
   *
   * Answers whether a save is owed: the local copy held something the file does
   * not — the app was killed, or its last write lost a collision.
   */
  async load(): Promise<boolean> {
    const read = await this.read();
    const local = this.readLocal();
    // An unreadable file at load is survivable: start from what this device
    // last knew, and the first refresh that reads the file merges the rest.
    const base = read.kind === "state" ? read.state : this.codec.empty();
    this.state = local ? this.codec.merge(local, base) : base;
    await this.noteDiskTime();
    if (read.kind === "unreadable") return local !== null;
    if (read.kind === "absent") return local !== null;
    return canonical(this.state) !== canonical(read.state);
  }

  /** What is in the file this instant. */
  async read(path = this.path): Promise<FileRead<T>> {
    try {
      if (!(await this.disk.exists(path))) return { kind: "absent" };
      const raw = await this.disk.read(path);
      return { kind: "state", state: this.codec.parse(JSON.parse(raw)) };
    } catch {
      return { kind: "unreadable" };
    }
  }

  private async readForSave(): Promise<FileRead<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const read = await this.read();
      if (read.kind !== "unreadable" || attempt >= READ_ATTEMPTS - 1) return read;
      await this.sleep(READ_BACKOFF_MS[attempt] ?? 600);
    }
  }

  /** Conflict copies that could be read, with their paths. */
  private async conflicts(): Promise<Array<{ path: string; state: T }>> {
    let files: string[];
    try {
      const slash = this.path.lastIndexOf("/");
      files = (await this.disk.list(slash >= 0 ? this.path.slice(0, slash) : "")).files;
    } catch {
      return [];
    }
    const found: Array<{ path: string; state: T }> = [];
    for (const path of conflictCopies(this.path, files)) {
      const read = await this.read(path);
      // An unreadable copy is left alone — never deleted unread.
      if (read.kind === "state") found.push({ path, state: read.state });
    }
    return found;
  }

  private readLocal(): T | null {
    try {
      const raw = this.local?.read();
      return raw ? this.codec.parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private writeLocal(text: string): void {
    try {
      this.local?.write(text);
    } catch {
      // Full or unavailable: the synced file is still the record.
    }
  }

  private async noteDiskTime(): Promise<void> {
    try {
      this.diskTime = stamp(await this.disk.stat(this.path));
    } catch {
      // A stat that failed is not evidence of anything.
    }
  }

  /**
   * Merge into the file, or refuse.
   *
   * The local copy is written first and synchronously, before the queue: a save
   * waiting behind a slow read must not be the reason an app kill loses it.
   */
  save(): Promise<SaveOutcome<T>> {
    this.writeLocal(JSON.stringify(this.state));
    this.saving = this.saving
      .then(() => this.saveNow())
      .catch(() => ({ landed: false, wrote: false, disk: null }));
    return this.saving;
  }

  private async saveNow(): Promise<SaveOutcome<T>> {
    const read = await this.readForSave();
    // Never over a file we could not read: what the other device decided may
    // be in it and nowhere else.
    if (read.kind === "unreadable") return { landed: false, wrote: false, disk: null };

    const copies = await this.conflicts();
    let merged = read.kind === "state" ? this.codec.merge(this.state, read.state) : this.state;
    for (const copy of copies) merged = this.codec.merge(merged, copy.state);
    this.state = merged;

    const disk = read.kind === "state" ? read.state : null;
    if (disk && copies.length === 0 && canonical(merged) === canonical(disk)) {
      this.owed = false;
      // Already there. Not writing is the point: every write is another chance
      // to collide with the other device's.
      return { landed: true, wrote: false, disk };
    }

    const text = JSON.stringify(merged);
    await this.disk.write(this.path, text);
    await this.noteDiskTime();
    this.owed = false;
    this.writeLocal(text);
    for (const copy of copies) {
      try {
        await this.disk.remove(copy.path);
      } catch {
        // Merged already; the next save tries again.
      }
    }
    return { landed: true, wrote: true, disk };
  }

  /**
   * Fold in what the other device wrote, and send back what it is missing.
   *
   * A stat, a directory listing, and a read only when something moved — cheap
   * enough for a 5-second timer. Answers whether memory changed.
   */
  async refresh(): Promise<boolean> {
    let mtime: string;
    try {
      mtime = stamp(await this.disk.stat(this.path));
    } catch {
      return false;
    }
    const copies = await this.conflicts();
    if (mtime === this.diskTime && copies.length === 0) {
      this.maybeWriteBack();
      return false;
    }

    const read = await this.read();
    if (read.kind === "unreadable") return false;
    this.diskTime = mtime;

    const before = canonical(this.state);
    let merged = read.kind === "state" ? this.codec.merge(this.state, read.state) : this.state;
    for (const copy of copies) merged = this.codec.merge(merged, copy.state);
    this.state = merged;

    this.owed =
      copies.length > 0 ||
      (read.kind === "state" ? canonical(merged) !== canonical(read.state) : true);
    // A fresh copy that already holds everything: the devices agree again.
    if (!this.owed) this.gap = WRITE_BACK_GAP_MS;
    const changed = canonical(merged) !== before;
    // Kept current, so a relaunch that finds the file mid-download starts from
    // what this device last saw rather than from its last save.
    if (changed) this.writeLocal(JSON.stringify(merged));
    this.maybeWriteBack();
    return changed;
  }

  private maybeWriteBack(): void {
    if (!this.owed || !this.writeBack || this.now() - this.lastWriteBack < this.gap) return;
    // Owed again within twice the gap of the last one: the copies are crossing.
    if (this.now() - this.lastWriteBack < 2 * this.gap) {
      this.gap = Math.min(WRITE_BACK_MAX_GAP_MS, this.gap * 2);
    }
    this.lastWriteBack = this.now() + Math.floor(this.random() * this.gap * 0.5);
    void this.save();
  }

  /** Wait for any save in flight. */
  settle(): Promise<SaveOutcome<T>> {
    return this.saving;
  }
}

/**
 * `LocalCopy` over Obsidian's vault-scoped local storage (`App.loadLocalStorage`),
 * which lives on this device only and is never synced.
 */
export function appLocalCopy(
  app: { loadLocalStorage(key: string): unknown; saveLocalStorage(key: string, data: unknown): void },
  key: string,
): LocalCopy {
  return {
    read: () => {
      const value = app.loadLocalStorage(key);
      return typeof value === "string" ? value : null;
    },
    write: (value) => app.saveLocalStorage(key, value),
  };
}

/** `SyncDisk` over Obsidian's vault adapter. */
export function adapterDisk(adapter: {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  stat(path: string): Promise<{ mtime: number; size?: number } | null>;
  list(path: string): Promise<{ files: string[] }>;
  remove(path: string): Promise<void>;
}): SyncDisk {
  return {
    exists: (path) => adapter.exists(path),
    read: (path) => adapter.read(path),
    write: (path, data) => adapter.write(path, data),
    stat: (path) => adapter.stat(path),
    list: (path) => adapter.list(path),
    remove: (path) => adapter.remove(path),
  };
}
