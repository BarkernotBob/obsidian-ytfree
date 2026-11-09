/**
 * The offline HD player's file reads (GitHub #38). See `../offline-hd.ts`.
 */
import { promises as fs } from "fs";
import path from "path";
import type { FetchRange } from "../adaptive.ts";
import { offlineFile, parseOfflineManifest } from "../offline-hd.ts";
import type { OfflineManifest } from "../offline-hd.ts";

/** `offline.json` from `folder`, or an error that says what is wrong. */
export async function loadOfflineManifest(folder: string): Promise<OfflineManifest> {
  const text = await fs.readFile(path.join(folder, "offline.json"), "utf8");
  const manifest = parseOfflineManifest(text);
  if (!manifest) throw new Error(`${folder}/offline.json is not an offline HD manifest`);
  return manifest;
}

/** Byte ranges from the folder's files, in the shape the HD stitcher reads. */
export function offlineFetchRange(folder: string): FetchRange {
  return async (url, start, end) => {
    const name = offlineFile(url);
    if (!name) throw Object.assign(new Error("HTTP 404"), { status: 404 });
    const handle = await fs.open(path.join(folder, name), "r");
    try {
      const buffer = Buffer.alloc(end - start + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      if (bytesRead === 0) throw Object.assign(new Error("HTTP 416"), { status: 416 });
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
    } finally {
      await handle.close();
    }
  };
}
