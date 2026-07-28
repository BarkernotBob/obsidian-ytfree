/**
 * The account import's Node half: the cookie file, and running yt-dlp with it.
 *
 * Desktop only, and never imported at the top of a file mobile loads — the
 * `fs` and `child_process` imports below throw at module load on iOS. Reach it
 * through `await import("./desktop")` inside a `Platform.isDesktopApp` branch.
 */

import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { PrintRow, SessionCookie } from "../account.ts";
import { parsePrintRows, PRINT_TEMPLATE, toNetscape } from "../account.ts";

const pExecFile = promisify(execFile);

/**
 * Outside the vault, and not negotiable.
 *
 * What this file holds is a live Google session — unscoped access to the whole
 * account, not a scoped token. The vault is in iCloud, so a copy inside it
 * would sync to every Mac and to Apple's servers. `Application Support` is
 * local, per-user, and already the place this kind of thing belongs.
 */
export function defaultCookieFile(): string {
  return path.join(os.homedir(), "Library", "Application Support", "obsidian-ytfree", "cookies.txt");
}

export function resolveCookieFile(configured: string): string {
  const chosen = configured.trim();
  return chosen ? chosen.replace(/^~(?=\/)/, os.homedir()) : defaultCookieFile();
}

/** Write the session out for yt-dlp. Mode 600, and the directory 700. */
export function writeCookieFile(file: string, cookies: SessionCookie[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, toNetscape(cookies), { mode: 0o600 });
  // `writeFileSync`'s mode is only applied when it creates the file, so an
  // existing one keeps whatever permissions it had. Set them either way.
  fs.chmodSync(file, 0o600);
}

export function deleteCookieFile(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export function cookieFileExists(file: string): boolean {
  return fs.existsSync(file);
}

/** Octal permissions of the cookie file, for the settings pane to show. */
export function cookieFileMode(file: string): string | null {
  try {
    return (fs.statSync(file).mode & 0o777).toString(8);
  } catch {
    return null;
  }
}

export interface AccountListOptions {
  /** Cap on entries. History in particular is enormous and mostly irrelevant. */
  limit?: number;
  timeoutMs?: number;
}

/**
 * One authenticated listing.
 *
 * `--flat-playlist` is what keeps this to a single request per list instead of
 * one per video, and it is why Watch Later arrives without descriptions. The
 * cookie file is passed by path and never through the environment or the
 * command line as a value, so it does not show up in `ps`.
 */
export async function listWithCookies(
  ytDlpPath: string,
  cookieFile: string,
  target: string,
  options: AccountListOptions = {},
): Promise<PrintRow[]> {
  const args = [
    "--cookies",
    cookieFile,
    "--flat-playlist",
    "--ignore-no-formats-error",
    "--no-warnings",
    "--print",
    PRINT_TEMPLATE,
    "--socket-timeout",
    "30",
  ];
  if (options.limit && options.limit > 0) args.push("--playlist-end", String(options.limit));
  args.push(target);

  try {
    const { stdout } = await pExecFile(ytDlpPath, args, {
      timeout: options.timeoutMs ?? 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parsePrintRows(stdout);
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error((e.stderr || e.message || "yt-dlp failed").trim().split("\n").slice(-3).join(" "));
  }
}

/** The three lists, named where the callers can read them. */
export const ACCOUNT_TARGETS = {
  /** The subscription manager page: every channel, including dormant ones. */
  channelsPage: "https://www.youtube.com/feed/channels",
  /** The subscription feed: videos, which only names channels that posted. */
  subsFeed: ":ytsubs",
  watchLater: ":ytwatchlater",
  history: ":ythistory",
} as const;
