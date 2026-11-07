/**
 * YouTube's bot check, and the pause that follows one (GitHub #31).
 *
 * When YouTube answers "Sign in to confirm you're not a bot", every further
 * automatic request from this network makes things worse: on 2026-11-04 a day
 * of retries and probes kept Isaiah's home IP flagged. So the first bot check
 * pauses everything the plugin does on its own (polls, backfills, HD lookups,
 * recovery retries, auto transcripts) for `BOT_CHECK_COOLDOWN_MS`. Only an
 * explicit action, opening a video to watch it, still tries once.
 *
 * This file has no `obsidian` import, so it is tested directly and shared by
 * the desktop resolver, InnerTube and the app. The pause is stored on the
 * device (never in the vault: it is about this network, not this vault), so a
 * plugin reload does not reset it.
 */

export const BOT_CHECK_COOLDOWN_MS = 45 * 60_000;

/** yt-dlp's and InnerTube's wording for the bot check. Not an age gate. */
const BOT_TEXT = /confirm you.?re not a bot/i;

/** A yt-dlp error, an InnerTube reason, or any text carrying the bot check. */
export function isBotCheckText(text: string): boolean {
  return BOT_TEXT.test(text);
}

export function isBotCheck(err: unknown): boolean {
  return isBotCheckText(err instanceof Error ? err.message : String(err));
}

/**
 * A player response refused by the bot check. `LOGIN_REQUIRED` alone is not
 * enough: age-restricted and members-only videos answer it too ("This video
 * may be inappropriate for some users"), and pausing the plugin for one of
 * those would be wrong.
 */
export function isBotCheckPlayability(status: unknown, reason: unknown): boolean {
  return status === "LOGIN_REQUIRED" && typeof reason === "string" && isBotCheckText(reason);
}

/** Thrown instead of sending an automatic request while paused. */
export class BotCheckPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotCheckPausedError";
  }
}

/** "14:05", in the device's local time. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The one message, for the player's status line, the hub and the error box. */
export function pauseMessage(until: number): string {
  return (
    "YouTube is asking this network to prove it isn't a bot. " +
    `YT Free is pausing its requests until ${clockTime(until)}.`
  );
}

/** Where the pause survives a reload. `localStorage` in the app. */
export interface PauseStore {
  read(): string | null;
  write(value: string | null): void;
}

export class BotCheckBreaker {
  private until = 0;
  private store: PauseStore | null = null;
  private listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Read a pause left by an earlier session, and keep the next one there. */
  attach(store: PauseStore): void {
    this.store = store;
    let stored = NaN;
    try {
      stored = Number(store.read());
    } catch {
      // Storage unavailable: the pause lives in memory only.
    }
    if (Number.isFinite(stored) && stored > this.until) this.until = stored;
  }

  /** A bot check was seen: pause from now. A later one extends the pause. */
  trip(): void {
    this.until = this.now() + BOT_CHECK_COOLDOWN_MS;
    this.persist(String(this.until));
    this.emit();
  }

  /** End the pause early. Tests use it; nothing in the app does. */
  clear(): void {
    if (this.until === 0) return;
    this.until = 0;
    this.persist(null);
    this.emit();
  }

  /** When the pause ends, or null when there is none. */
  pausedUntil(): number | null {
    return this.until > this.now() ? this.until : null;
  }

  isPaused(): boolean {
    return this.pausedUntil() !== null;
  }

  /** The message while paused, or null. */
  message(): string | null {
    const until = this.pausedUntil();
    return until === null ? null : pauseMessage(until);
  }

  /** For automatic work: throws instead of letting a request go out. */
  guard(): void {
    const until = this.pausedUntil();
    if (until !== null) throw new BotCheckPausedError(pauseMessage(until));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(value: string | null): void {
    try {
      this.store?.write(value);
    } catch {
      // Best effort: the in-memory pause still holds for this session.
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // One broken listener must not stop the others.
      }
    }
  }
}

/** The plugin's one breaker, shared by every module that talks to YouTube. */
export const botCheck = new BotCheckBreaker();
