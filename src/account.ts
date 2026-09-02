/**
 * The account import — everything in it that does not need Node or Obsidian.
 *
 * Cookie serialisation, the yt-dlp output parsing, and the merge rules live
 * here so they can be tested without a signed-in session. The window that does
 * the signing in is `desktop/signin.ts`; the process that runs yt-dlp is
 * `desktop/account.ts`.
 *
 * The one rule the whole feature is bent around: cookies go on account-data
 * calls only. Never on playback, stream resolution, RSS polling, transcripts or
 * downloads. That split is what keeps what you watch in Obsidian off your
 * YouTube account, and it is the reason this file exists separately at all.
 */

import type { HubItem } from "./subscriptions.ts";
import { relativeAge } from "./subscriptions.ts";

/**
 * What yt-dlp needs to see to consider the session usable. `LOGIN_INFO` is the
 * YouTube-domain one; the rest are Google-wide. A partition holding only some
 * of these is a half-finished sign-in, not a session.
 */
export const AUTH_COOKIE_NAMES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "LOGIN_INFO",
] as const;

/** The subset of Electron's cookie shape this code actually reads. */
export interface SessionCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  session?: boolean;
  expirationDate?: number;
}

export function missingAuthCookies(cookies: Array<{ name: string }>): string[] {
  const names = new Set(cookies.map((c) => c.name));
  return AUTH_COOKIE_NAMES.filter((n) => !names.has(n));
}

export function hasCompleteSession(cookies: Array<{ name: string }>): boolean {
  return missingAuthCookies(cookies).length === 0;
}

/**
 * Netscape cookie file — the format `yt-dlp --cookies` reads.
 *
 * Tab-separated, and the domain is written with a leading dot so it is treated
 * as a subdomain match: the session cookies are set on `.google.com` and
 * `.youtube.com`, and yt-dlp talks to `www.youtube.com`. Session cookies (no
 * expiry) are written as `0`, which the format reads as "expires at end of
 * session" — yt-dlp still sends them.
 */
export function toNetscape(cookies: SessionCookie[]): string {
  const rows = cookies.map((c) => {
    const domain = c.domain.startsWith(".") ? c.domain : "." + c.domain;
    const expires = c.session ? 0 : Math.floor(c.expirationDate ?? 0);
    return [
      domain,
      "TRUE",
      c.path || "/",
      c.secure ? "TRUE" : "FALSE",
      String(expires),
      c.name,
      c.value,
    ].join("\t");
  });
  return (
    "# Netscape HTTP Cookie File\n" +
    "# Written by the YT Free Obsidian plugin. This is a live Google session —\n" +
    "# treat it like a password. Sign out in the plugin to delete it.\n" +
    rows.join("\n") +
    "\n"
  );
}

// ------------------------------------------------------------------- yt-dlp

/**
 * One row of `--print`. Every list yt-dlp gives us is asked for in the same
 * shape, so there is one parser rather than three.
 */
export interface PrintRow {
  id: string;
  title: string | null;
  channelId: string | null;
  channelTitle: string | null;
}

/** The `--print` template every account call uses. Order matches `PrintRow`. */
export const PRINT_TEMPLATE = "%(id)s\t%(title)s\t%(channel_id)s\t%(channel)s";

/** yt-dlp prints this for a field the flat listing does not carry. */
function field(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" || text === "NA" || text === "None" ? null : text;
}

export function parsePrintRows(stdout: string): PrintRow[] {
  const rows: PrintRow[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const id = field(parts[0]);
    if (!id) continue;
    rows.push({
      id,
      title: field(parts[1]),
      channelId: field(parts[2]),
      channelTitle: field(parts[3]),
    });
  }
  return rows;
}

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export interface ImportedChannel {
  id: string;
  title: string;
}

/**
 * Channels out of `/feed/channels` — the subscription manager page, where every
 * row *is* a channel, so the entry's own id is the channel id.
 */
export function channelsFromChannelsPage(rows: PrintRow[]): ImportedChannel[] {
  const byId = new Map<string, ImportedChannel>();
  for (const row of rows) {
    if (!CHANNEL_ID_RE.test(row.id)) continue;
    if (!byId.has(row.id)) byId.set(row.id, { id: row.id, title: row.title ?? row.id });
  }
  return [...byId.values()];
}

/**
 * Channels out of `:ytsubs` — the subscription *feed*, whose entries are videos.
 * Each one names the channel that posted it, so this yields only the channels
 * that have uploaded recently.
 *
 * This is the fallback, and it is a strictly smaller list than the real
 * subscription list. A dormant channel appears in neither this nor the hub, and
 * that difference is why `/feed/channels` is tried first.
 */
export function channelsFromSubsFeed(rows: PrintRow[]): ImportedChannel[] {
  const byId = new Map<string, ImportedChannel>();
  for (const row of rows) {
    if (!row.channelId || !CHANNEL_ID_RE.test(row.channelId)) continue;
    if (!byId.has(row.channelId)) {
      byId.set(row.channelId, { id: row.channelId, title: row.channelTitle ?? row.channelId });
    }
  }
  return [...byId.values()];
}

/** Video IDs out of a history listing, newest first, de-duplicated. */
export function videoIdsFrom(rows: PrintRow[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    if (!VIDEO_ID_RE.test(row.id) || seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

// -------------------------------------------------------------------- merge

/**
 * Fold Watch Later into the hub's items.
 *
 * An item already in the hub is never rewritten — same rule as the feed merge —
 * because its state, its note path and its cached description are all things a
 * flat Watch Later listing cannot improve on. It only gains the Watch Later
 * origin so the hub can say where it came from.
 *
 * New Watch Later items arrive with **no description and no publish date**.
 * Flat mode carries neither, and fetching them per item would be one network
 * round trip per video. The missing publish date has a useful side effect: the
 * expiry rule ignores items it cannot date, so a Watch Later item never expires
 * out of the hub on its own. Watch Later is a list you built on purpose.
 */
export function mergeWatchLater(
  existing: HubItem[],
  rows: PrintRow[],
  now: Date,
): { items: HubItem[]; added: number } {
  const byId = new Map(existing.map((item) => [item.videoId, item]));
  let added = 0;

  for (const row of rows) {
    if (!VIDEO_ID_RE.test(row.id)) continue;
    const known = byId.get(row.id);
    if (known) {
      known.origin = known.origin === "feed" || !known.origin ? "both" : known.origin;
      continue;
    }
    byId.set(row.id, {
      videoId: row.id,
      channelId: row.channelId ?? "",
      channelTitle: row.channelTitle ?? "",
      title: row.title ?? row.id,
      published: "",
      thumbnail: `https://i.ytimg.com/vi/${row.id}/mqdefault.jpg`,
      description: "",
      views: null,
      isShort: null,
      state: "new",
      seenAt: now.toISOString(),
      origin: "watchlater",
    });
    added++;
  }

  return { items: [...byId.values()], added };
}

/**
 * Mark anything already watched elsewhere.
 *
 * One-directional, always: history is read in so the hub can stop showing you
 * what you have seen. Nothing in this plugin ever writes to YouTube history,
 * which is the whole reason playback stays anonymous.
 */
export function applyWatched(items: HubItem[], videoIds: string[]): number {
  const watched = new Set(videoIds);
  let marked = 0;
  for (const item of items) {
    if (!watched.has(item.videoId) || item.watched) continue;
    item.watched = true;
    marked++;
  }
  return marked;
}

// ------------------------------------------------------------------ session

export type SessionStatus = "signed-out" | "signed-in" | "expired";

export interface AccountSession {
  status: SessionStatus;
  /** Display name from the sign-in window, or null if it could not be read. */
  name: string | null;
  /** ISO time of the last successful authenticated sync. */
  lastSyncAt: string | null;
  /**
   * ISO time of the last sync *attempt*, successful or not.
   *
   * `lastSyncAt` used to do both jobs by being advanced on a failure, which
   * made settings claim a sync that never happened and left an expired session
   * with no stamp at all to pace a retry from — so nothing ever retried. Two
   * fields: one for what succeeded, one for what the schedule measures.
   * Optional, so a session written before this field existed still loads.
   */
  lastAttemptAt?: string | null;
  /** Why the last sync failed, shown in settings. */
  lastError: string | null;
}

export function emptySession(): AccountSession {
  return {
    status: "signed-out",
    name: null,
    lastSyncAt: null,
    lastAttemptAt: null,
    lastError: null,
  };
}

/**
 * The error a sync raises when the cookie file is not on disk.
 *
 * Worded so it does *not* read as an expiry, which is the whole point: the
 * previous wording ("cookies are no longer valid…") matched `looksLikeExpiry`,
 * latched the session, and stopped the schedule over a file that could simply
 * be re-read the next period. See `looksLikeMissingCookieFile`.
 */
export const COOKIE_FILE_MISSING = "the cookie file is missing";

/**
 * A failure that is about the file rather than about Google.
 *
 * The old message is matched too, because there is a session sitting in a
 * vault right now that was latched by it and has to heal itself on load — see
 * `unwedgeSession`.
 */
export function looksLikeMissingCookieFile(message: string): boolean {
  return /the cookie file is (gone|missing)|no cookie file/i.test(message);
}

/**
 * Un-latch a session that was expired over a file that is now there.
 *
 * `expired` means *a human has to sign in again*, and it stops the schedule
 * dead. A missing cookie file never deserved that verdict, but it got it, and
 * the state it wrote outlives the code that wrote it: the file came back ten
 * days later and nothing looked. Run at load, against the file as it is now.
 */
export function unwedgeSession(
  session: AccountSession,
  cookieFilePresent: boolean,
): AccountSession {
  if (session.status !== "expired" || !cookieFilePresent) return session;
  if (!session.lastError || !looksLikeMissingCookieFile(session.lastError)) return session;
  return { ...session, status: "signed-in", lastError: null };
}

/** The one line settings shows. Kept here so the wording is testable. */
export function describeSession(session: AccountSession, now: Date): string {
  if (session.status === "signed-out") return "Not signed in.";
  if (session.status === "expired") {
    return "Session expired — sign in again." + (session.lastError ? ` (${session.lastError})` : "");
  }
  const who = session.name ? `Signed in as ${session.name}` : "Signed in";
  // A signed-in session that is failing says so. It used to look identical to a
  // healthy one here, which is half of why a month of failures went unnoticed.
  const trouble = session.lastError ? ` Last sync failed — ${session.lastError}` : "";
  if (!session.lastSyncAt) return `${who}. Not synced yet.${trouble}`;
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(session.lastSyncAt)) / 60_000));
  if (minutes < 1) return `${who}. Synced just now.${trouble}`;
  if (minutes < 60) {
    return `${who}. Synced ${minutes} minute${minutes === 1 ? "" : "s"} ago.${trouble}`;
  }
  const hours = Math.round(minutes / 60);
  return `${who}. Synced ${hours} hour${hours === 1 ? "" : "s"} ago.${trouble}`;
}

/** The newest stamp the schedule may measure from, or null if there is none. */
function lastAttemptTime(session: AccountSession): number | null {
  const times = [session.lastAttemptAt, session.lastSyncAt]
    .map((stamp) => (stamp ? Date.parse(stamp) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? Math.max(...times) : null;
}

/**
 * Does an authenticated sync fall due?
 *
 * yt-dlp's own documentation warns that recurring authenticated requests can
 * get an account flagged, so the gap is a floor and never an approximation:
 * "not yet" is always the safe answer.
 *
 * An **expired** session falls due too, at exactly the same rate — one probe a
 * period, no faster. Never re-probing is what turned a five-week outage into a
 * silent one: the thing that expired the session was a missing file, the file
 * came back, and no code path was ever going to look again. One wasted yt-dlp
 * call every twelve hours is the price of noticing. Only `signed-out` — nobody
 * has ever signed in, or they signed out on purpose — is never due.
 */
export function syncIsDue(session: AccountSession, everyHours: number, now: Date): boolean {
  if (session.status === "signed-out") return false;
  const last = lastAttemptTime(session);
  if (last === null) return true;
  return now.getTime() - last >= Math.max(1, everyHours) * 3_600_000;
}

/**
 * What the hub says about the account, beside what it says about the feeds.
 *
 * Null means there is nothing to say — nobody has signed in, so there is no
 * sync to be silent about. Everything else gets a phrase, and the two states
 * worth interrupting for get `alert`.
 *
 * "Stale" is two sync periods, not one: a period is a floor and a laptop that
 * was shut when one fell due is not a fault.
 */
export interface AccountLine {
  /** The phrase for the hub's status strip. */
  text: string;
  /** Worth its own banner: expired, or nothing has succeeded in two periods. */
  alert: boolean;
  /** What the banner's button does. Null when the line is not an alert. */
  action: "sign-in" | "sync" | null;
}

export function accountStatusLine(
  session: AccountSession,
  everyHours: number,
  now: Date,
): AccountLine | null {
  if (session.status === "signed-out") return null;
  if (session.status === "expired") {
    return {
      text: "YouTube session expired — account sync has stopped",
      alert: true,
      action: "sign-in",
    };
  }
  const period = Math.max(1, everyHours) * 3_600_000;
  const last = session.lastSyncAt ? Date.parse(session.lastSyncAt) : Number.NaN;
  if (!Number.isFinite(last)) {
    return { text: "account not synced yet", alert: false, action: null };
  }
  const stale = now.getTime() - last >= 2 * period;
  const age = relativeAge(session.lastSyncAt ?? "", now);
  if (stale) {
    return { text: `account last synced ${age}`, alert: true, action: "sync" };
  }
  return { text: `account synced ${age}`, alert: false, action: null };
}

/**
 * Whether a yt-dlp failure means the session is gone rather than the network.
 *
 * This matters more than it looks: a session marked expired stops the schedule
 * until you sign in again, and hammering an expired session on a timer is
 * exactly the pattern that gets an account flagged. A timeout must not be
 * mistaken for it, and neither must a signed-out response be tolerated.
 */
export function looksLikeExpiry(message: string): boolean {
  // The file being absent is not a verdict about the session. It was, for five
  // weeks, and this line is why it will not be again — the legacy wording said
  // "cookies are no longer valid" and matched below.
  if (looksLikeMissingCookieFile(message)) return false;
  return /login details are needed|sign in to confirm|cookies are no longer valid|not a bot|account cookies|http error 401|http error 403/i.test(
    message,
  );
}
