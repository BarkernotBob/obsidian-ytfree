/**
 * A ▶ on the macOS dock icon for as long as Obsidian is making noise.
 *
 * `require("@electron/remote")` at the bottom of this file is why it lives
 * under `src/desktop/` — see `desktop/index.ts` for the rule. On iOS the
 * require throws at module load, and there is no dock to badge anyway.
 *
 * The signal is Chromium's own `isCurrentlyAudible()`, not our `<video>`
 * element, and that choice is the whole design:
 *
 *   - it is true of *the process*, so a PodNotes episode or an RSS Dashboard
 *     stream lights the badge exactly as our player does. See
 *     `docs/V1-SCOPE-DOCK-BADGE.md` for why that is the accepted behaviour of
 *     a feature living inside this plugin rather than a bug;
 *   - muted and volume-zero playback report false, which is the answer a
 *     person looking at a dock icon wants;
 *   - it reaches audio a DOM listener cannot see — a `<webview>`, and a note
 *     popped out into its own window. Obsidian's popouts are `window.open`
 *     children: same JS context, *different* `WebContents`. A `play` listener
 *     on `document` would miss them; the sweep below does not.
 */

/** The badge glyph. macOS draws it in a red pill in the corner of the tile. */
export const BADGE_TEXT = "▶";

/**
 * How often the sweep runs.
 *
 * The event below makes the common case instant, so this interval only has to
 * be fast enough for the cases the event does not cover — audio starting in a
 * popout or a webview. Every call across `@electron/remote` is a *synchronous*
 * IPC round trip, so this is a handful of sub-millisecond blocks per second on
 * the UI thread; it is cheap, but it is not free, and that is the reason this
 * is 2 s and not 200 ms.
 */
export const SWEEP_MS = 2_000;

/** The half of Electron's `WebContents` this file needs. Narrow, so it fakes. */
export interface AudibleSource {
  isDestroyed(): boolean;
  isCurrentlyAudible(): boolean;
}

export interface DockLike {
  setBadge(text: string): void;
}

export interface BadgeEnv {
  dock: DockLike;
  /** Every `WebContents` in the app, ours and everyone else's. */
  allSources(): AudibleSource[];
}

/**
 * Is anything making sound right now?
 *
 * Each question is asked inside its own `try`: the list is a snapshot taken one
 * IPC hop ago, and a `WebContents` that closed in between throws rather than
 * answering. One dead window must not cost the badge its answer about the rest.
 */
export function anyAudible(sources: AudibleSource[]): boolean {
  for (const source of sources) {
    try {
      if (!source.isDestroyed() && source.isCurrentlyAudible()) return true;
    } catch {
      /* gone between the snapshot and the question — it is not making noise */
    }
  }
  return false;
}

/**
 * The badge, and the rules about who is allowed to write it.
 *
 * The dock tile is one object shared by every Obsidian window, and each vault
 * window runs its own copy of this plugin. So the two rules here are about
 * co-existence rather than about audio:
 *
 * **While audible, write on every sweep.** Idempotent, so two instances
 * agreeing costs nothing — and it is what makes the state self-healing. When
 * one window unloads and clears the badge out from under a second window that
 * is still playing, the second window's next sweep puts it back within 2 s.
 * Suppressing the repeat write would leave that badge off until playback
 * stopped and started again.
 *
 * **When silent, clear only a badge this instance set.** Otherwise a plugin
 * load during someone else's badge — Obsidian's own, some future plugin's —
 * would wipe it.
 */
export class DockAudioBadge {
  private shown = false;
  // A plain field and not a parameter property: `node --test` runs these
  // sources through strip-only type removal, which rejects the shorthand.
  private readonly env: BadgeEnv;

  constructor(env: BadgeEnv) {
    this.env = env;
  }

  refresh(): void {
    const audible = anyAudible(this.env.allSources());
    if (!audible && !this.shown) return;
    try {
      this.env.dock.setBadge(audible ? BADGE_TEXT : "");
      this.shown = audible;
    } catch {
      // A failed write leaves `shown` alone, so the next sweep tries again.
    }
  }

  /** Take down a badge this instance put up. Safe to call twice. */
  clear(): void {
    if (!this.shown) return;
    try {
      this.env.dock.setBadge("");
    } catch {
      /* the dock outlives us; a failure here is not worth a notice */
    }
    this.shown = false;
  }
}

export interface DockBadgeHandle {
  /** Recompute and write. Called on a timer, and on every audio state change. */
  refresh(): void;
  /** Unsubscribe and clear. */
  dispose(): void;
}

const AUDIO_EVENT = "audio-state-changed";

interface RemoteWebContents extends AudibleSource {
  on(event: string, listener: () => void): void;
  removeListener(event: string, listener: () => void): void;
}

interface RemoteApi {
  app: { dock?: DockLike };
  webContents: { getAllWebContents(): AudibleSource[] };
  getCurrentWebContents(): RemoteWebContents;
}

/**
 * `@electron/remote` exposes each main-process module as a property getter over
 * `getBuiltin`, which is why `remote.app` works at all. Same acquisition as
 * `signin.ts`, including the pre-14 fallback, because the two files have the
 * same reason to be careful: this is the one API in the plugin that is not
 * Obsidian's and can be taken away by a version bump.
 */
function getRemote(): RemoteApi | null {
  try {
    const remote = require("@electron/remote") as RemoteApi | undefined;
    if (remote?.app) return remote;
  } catch {
    /* fall through to the older name */
  }
  try {
    const electron = require("electron") as { remote?: RemoteApi };
    return electron?.remote ?? null;
  } catch {
    return null;
  }
}

/**
 * Everything the badge depends on, asked one question at a time.
 *
 * The badge fails silently by design — every write is in a `try` and macOS
 * itself ignores `setBadge` under conditions it does not report — so "no badge"
 * has half a dozen indistinguishable causes. This turns it into a list.
 */
export function diagnoseDockBadge(): Record<string, unknown> {
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    platform: process.platform,
    electron: process.versions?.electron ?? null,
  };

  let remote: RemoteApi | null = null;
  try {
    remote = getRemote();
    report.remote = remote ? "resolved" : "null";
  } catch (err) {
    report.remote = `threw: ${String(err)}`;
  }
  if (!remote) return report;

  try {
    report.appName = (remote.app as { getName?: () => string }).getName?.() ?? "no getName";
  } catch (err) {
    report.appName = `threw: ${String(err)}`;
  }

  const dock = (() => {
    try {
      return remote.app.dock ?? null;
    } catch (err) {
      report.dock = `threw: ${String(err)}`;
      return null;
    }
  })();
  report.dock = report.dock ?? (dock ? "present" : "absent");
  report.setBadgeType = dock ? typeof dock.setBadge : "n/a";

  // The documented caveat: "You need to ensure that your application has the
  // permission to display notifications for this method to work."
  try {
    report.notificationPermission = typeof Notification === "undefined" ? "no API" : Notification.permission;
  } catch (err) {
    report.notificationPermission = `threw: ${String(err)}`;
  }

  try {
    const all = remote.webContents.getAllWebContents();
    report.webContents = all.length;
    report.audible = all.filter((wc) => {
      try {
        return !wc.isDestroyed() && wc.isCurrentlyAudible();
      } catch {
        return false;
      }
    }).length;
  } catch (err) {
    report.webContents = `threw: ${String(err)}`;
  }

  // The write itself, and then a read-back if macOS offers one.
  if (dock) {
    try {
      dock.setBadge(BADGE_TEXT);
      report.setBadge = "no error";
      const readable = dock as { getBadge?: () => string };
      report.badgeReadBack = readable.getBadge ? readable.getBadge() : "no getBadge";
    } catch (err) {
      report.setBadge = `threw: ${String(err)}`;
    }
  }

  return report;
}

/**
 * Wire the badge to Electron, or return null and leave the dock alone.
 *
 * Null is a normal answer, not a failure: it is what Windows, Linux and a
 * future Obsidian that drops the remote module all get. Nothing else in the
 * plugin branches on it.
 */
export function createDockAudioBadge(): DockBadgeHandle | null {
  if (process.platform !== "darwin") return null;

  const remote = getRemote();
  const dock = remote?.app.dock;
  if (!remote || !dock) return null;

  const badge = new DockAudioBadge({
    dock,
    allSources: () => {
      try {
        return remote.webContents.getAllWebContents();
      } catch {
        return [];
      }
    },
  });

  // The event fires on our own renderer only, which covers every ordinary
  // case — our player, PodNotes, anything in the main window — and makes those
  // instant instead of up-to-2 s late. It is an optimisation over the sweep,
  // never the source of truth, so a failure to subscribe is survivable.
  const onChange = () => badge.refresh();
  let current: RemoteWebContents | null = null;
  try {
    current = remote.getCurrentWebContents();
    current.on(AUDIO_EVENT, onChange);
  } catch {
    current = null;
  }

  return {
    refresh: () => badge.refresh(),
    dispose: () => {
      // Before the clear: a listener left behind holds a callback in the main
      // process for the life of the window, and would go on refreshing a badge
      // whose plugin is gone.
      try {
        current?.removeListener(AUDIO_EVENT, onChange);
      } catch {
        /* the window is already gone, which removes the listener too */
      }
      badge.clear();
    },
  };
}
