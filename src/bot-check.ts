/**
 * YouTube's bot check, and the pause that follows one (GitHub #31, #66).
 *
 * When YouTube answers "Sign in to confirm you're not a bot", every further
 * automatic request from this network makes things worse: on 2026-11-04 a day
 * of retries and probes kept Isaiah's home IP flagged. So the first bot check
 * pauses everything the plugin does on its own (polls, backfills, HD lookups,
 * recovery retries, auto transcripts) until a request goes through again.
 *
 * Nothing retries on a timer. A retry is spent only by the reader pressing
 * Play: the first Play after 1 minute tries our stream once, then the first
 * after 5 more, 10, 30 minutes, 1 hour, 2 hours, then every 6 hours
 * (`RETRY_SCHEDULE_MS`, Isaiah 2026-11-09; YouTube publishes no figure, and
 * the old fixed 45 minutes was a pick, not a measurement). A Play between
 * retries sends nothing (YouTube's own player takes it once #43 lands). The
 * first retry that succeeds ends the pause for everything.
 *
 * This file has no `obsidian` import, so it is tested directly and shared by
 * the desktop resolver, InnerTube and the app. The pause is stored on the
 * device (never in the vault: it is about this network, not this vault), so a
 * plugin reload does not reset it.
 */

const MINUTE = 60_000;

/** Wait before retry 1, 2, 3…; the last one repeats. */
export const RETRY_SCHEDULE_MS: readonly number[] = [
  1 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  30 * MINUTE,
  60 * MINUTE,
  120 * MINUTE,
  360 * MINUTE,
];

/** The wait after the `strikes`-th bot check in a row (1-based). */
export function retryDelay(strikes: number): number {
  const i = Math.min(Math.max(strikes, 1), RETRY_SCHEDULE_MS.length) - 1;
  return RETRY_SCHEDULE_MS[i];
}

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

/**
 * The one message, for the player's status line, the hub and the error box.
 * `next` is when the next Play may try again; `now` says whether that is past.
 */
export function pauseMessage(next: number, now: number = Date.now()): string {
  return (
    "YouTube is asking this network to prove it isn't a bot. YouTube for You is pausing its requests" +
    (next > now
      ? ` and will try again with the first video you play after ${clockTime(next)}.`
      : " and will try again with the next video you play.")
  );
}

/** Where the pause survives a reload. `localStorage` in the app. */
export interface PauseStore {
  read(): string | null;
  write(value: string | null): void;
}

interface Stored {
  strikes: number;
  next: number;
}

/** Parses what `persist` wrote, and the plain end time older builds wrote. */
function parseStored(raw: string | null, now: number): Stored | null {
  if (!raw) return null;
  const legacy = Number(raw);
  if (Number.isFinite(legacy)) {
    // An older build's fixed pause: over once its end time has passed.
    return legacy > now ? { strikes: 1, next: legacy } : null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const strikes = Number(parsed.strikes);
    const next = Number(parsed.next);
    if (!Number.isInteger(strikes) || strikes < 1 || !Number.isFinite(next)) return null;
    return { strikes, next };
  } catch {
    return null;
  }
}

export class BotCheckBreaker {
  /** Bot checks in a row with no success between; 0 = not paused. */
  private strikes = 0;
  /** The earliest a Play may try again. */
  private next = 0;
  /** When the pause began; a success from a request sent before it says nothing. */
  private since = 0;
  private store: PauseStore | null = null;
  private listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Read a pause left by an earlier session, and keep the next one there. */
  attach(store: PauseStore): void {
    this.store = store;
    let stored: Stored | null = null;
    try {
      stored = parseStored(store.read(), this.now());
    } catch {
      // Storage unavailable: the pause lives in memory only.
    }
    if (stored && stored.strikes >= this.strikes) {
      this.strikes = stored.strikes;
      this.next = stored.next;
      this.since = 0;
    }
  }

  /**
   * A bot check was seen. The first starts the pause; one seen after the wait
   * was over is a failed retry and moves to the next, longer wait. One seen
   * while still waiting (a request already in flight) changes nothing, so a
   * burst of five feeds counts once.
   */
  trip(): void {
    const now = this.now();
    if (this.strikes > 0 && now < this.next) return;
    if (this.strikes === 0) this.since = now;
    this.strikes += 1;
    this.next = now + retryDelay(this.strikes);
    this.persist(JSON.stringify({ strikes: this.strikes, next: this.next }));
    this.emit();
  }

  /**
   * A request to YouTube went through. When it was sent during the pause
   * (`sentAt` at or after the pause began), the pause is over.
   */
  succeeded(sentAt: number): void {
    if (this.strikes === 0 || sentAt < this.since) return;
    this.clear();
  }

  /** End the pause. */
  clear(): void {
    if (this.strikes === 0) return;
    this.strikes = 0;
    this.next = 0;
    this.since = 0;
    this.persist(null);
    this.emit();
  }

  /** How many bot checks in a row, 0 when there is no pause. */
  strikeCount(): number {
    return this.strikes;
  }

  /** When the next Play may try, or null when there is no pause. */
  pausedUntil(): number | null {
    return this.strikes > 0 ? this.next : null;
  }

  /** Automatic work waits for a retry to succeed, however long that takes. */
  isPaused(): boolean {
    return this.strikes > 0;
  }

  /** True when a Play now would be a retry rather than wait. */
  retryDue(): boolean {
    return this.strikes > 0 && this.now() >= this.next;
  }

  /** The message while paused, or null. */
  message(): string | null {
    return this.strikes > 0 ? pauseMessage(this.next, this.now()) : null;
  }

  /** For automatic work: throws instead of letting a request go out. */
  guard(): void {
    const message = this.message();
    if (message !== null) throw new BotCheckPausedError(message);
  }

  /**
   * For the reader's Play: throws while waiting for the next retry, lets the
   * retry through once it is due, and lets everything through with no pause.
   */
  guardPlay(): void {
    if (this.strikes > 0 && this.now() < this.next) {
      throw new BotCheckPausedError(pauseMessage(this.next, this.now()));
    }
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
