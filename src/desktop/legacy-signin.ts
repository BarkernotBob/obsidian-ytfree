/**
 * Clean-up for the YouTube sign-in that used to exist (removed in GitHub #64).
 *
 * Earlier versions could sign in to YouTube and kept a live Google session in
 * two places: a Netscape cookie file outside the vault (default
 * `~/Library/Application Support/obsidian-ytfree/cookies.txt`, or a path the
 * user chose) and an Electron session partition. The plugin no longer reads
 * either, and a session nobody uses is still a session someone could steal, so
 * both are erased on the first load after the update.
 *
 * Desktop only, like everything under `src/desktop/`.
 */

import fs from "fs";
import os from "os";
import path from "path";

/** The partition the sign-in window used. Erased, never opened again. */
const LEGACY_PARTITION = "persist:ytfree-account";

export function legacyCookieFile(configured: string): string {
  const chosen = configured.trim();
  return chosen
    ? chosen.replace(/^~(?=\/)/, os.homedir())
    : path.join(os.homedir(), "Library", "Application Support", "obsidian-ytfree", "cookies.txt");
}

interface RemoteSession {
  session: { fromPartition(partition: string): { clearStorageData(): Promise<void> } };
}

function getRemote(): RemoteSession | null {
  try {
    const remote = require("@electron/remote") as RemoteSession | undefined;
    if (remote?.session) return remote;
  } catch {
    /* fall through to the older name */
  }
  try {
    const electron = require("electron") as { remote?: RemoteSession };
    return electron?.remote ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete the old cookie file and clear the old session partition.
 * Returns whether a cookie file was actually found and deleted.
 */
export async function removeLegacySignIn(configuredCookieFile: string): Promise<boolean> {
  let deleted = false;
  const file = legacyCookieFile(configuredCookieFile);
  try {
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      deleted = true;
    }
  } catch (err) {
    console.error("YouTube for You: could not delete the old YouTube cookie file.", err);
  }
  try {
    await getRemote()?.session.fromPartition(LEGACY_PARTITION).clearStorageData();
  } catch (err) {
    console.error("YouTube for You: could not clear the old YouTube sign-in session.", err);
  }
  return deleted;
}
