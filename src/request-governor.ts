/**
 * Every request the plugin sends to YouTube goes through here (GitHub #36).
 *
 * Three jobs:
 * - **Pace** the requests that ask YouTube who a video is (InnerTube calls and
 *   yt-dlp runs): at most `MAX_IN_FLIGHT` at once, and `PLAYER_GAP_MS` between
 *   player calls. Bursts of these, under several identities, are what got
 *   Isaiah's home IP flagged on 2026-11-04.
 * - **Cap background work**: jobs nobody is waiting on (duration backfill, feed
 *   backfill, Shorts probes, account sync, auto transcripts) check
 *   `backgroundRoom()` first and stop for the hour once `BACKGROUND_PER_HOUR`
 *   such requests have gone out. Playing a video is never capped, only queued.
 *   RSS feeds are counted but not capped: they are the endpoint YouTube offers
 *   for polling, and capping them would leave most channels unchecked.
 * - **Count** everything, for "YT Free: Show YouTube requests this session".
 *
 * No `obsidian` import: tested directly.
 */

export type RequestKind = "player" | "innertube" | "yt-dlp" | "range" | "feed" | "captions" | "probe";

export const MAX_IN_FLIGHT = 2;
export const PLAYER_GAP_MS = 500;
export const BACKGROUND_PER_HOUR = 60;
const HOUR_MS = 3600_000;

/** The kinds that are paced and that count against the background cap. */
const PACED: ReadonlySet<RequestKind> = new Set(["player", "innertube", "yt-dlp"]);
const CAPPED: ReadonlySet<RequestKind> = new Set(["player", "innertube", "yt-dlp", "probe", "captions"]);

const LABELS: Record<RequestKind, string> = {
  player: "player calls",
  innertube: "other InnerTube calls",
  "yt-dlp": "yt-dlp runs",
  range: "video byte reads",
  feed: "RSS feeds",
  captions: "caption files",
  probe: "Shorts checks",
};

export class RequestGovernor {
  readonly counts: Record<RequestKind, number> = {
    player: 0, innertube: 0, "yt-dlp": 0, range: 0, feed: 0, captions: 0, probe: 0,
  };
  private recent: number[] = [];
  private inFlight = 0;
  private waiting: Array<() => void> = [];
  private lastPlayerAt = -Infinity;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    now: () => number = () => Date.now(),
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.now = now;
    this.sleep = sleep;
  }

  /** Count a request that is not paced (byte reads, feeds, captions, probes). */
  count(kind: RequestKind): void {
    this.counts[kind] += 1;
    if (CAPPED.has(kind)) this.recent.push(this.now());
  }

  /** Run a request of `kind`, paced if it is one that asks who a video is. */
  async run<T>(kind: RequestKind, request: () => Promise<T>): Promise<T> {
    if (!PACED.has(kind)) {
      this.count(kind);
      return request();
    }
    await this.acquire();
    try {
      if (kind === "player") {
        const wait = this.lastPlayerAt + PLAYER_GAP_MS - this.now();
        if (wait > 0) await this.sleep(wait);
        this.lastPlayerAt = this.now();
      }
      this.count(kind);
      return await request();
    } finally {
      this.release();
    }
  }

  /** Whether background work may send another request this hour. */
  backgroundRoom(): boolean {
    const since = this.now() - HOUR_MS;
    this.recent = this.recent.filter((t) => t > since);
    return this.recent.length < BACKGROUND_PER_HOUR;
  }

  /** "12 player calls, 3 yt-dlp runs, …", or a line saying there were none. */
  summary(): string {
    const parts = (Object.keys(LABELS) as RequestKind[])
      .filter((kind) => this.counts[kind] > 0)
      .map((kind) => `${this.counts[kind]} ${LABELS[kind]}`);
    return parts.length ? parts.join(", ") : "no requests to YouTube yet";
  }

  private acquire(): Promise<void> {
    if (this.inFlight < MAX_IN_FLIGHT) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => {
      this.inFlight += 1;
      resolve();
    }));
  }

  private release(): void {
    this.inFlight -= 1;
    this.waiting.shift()?.();
  }
}

/** The plugin's one governor. */
export const governor = new RequestGovernor();
