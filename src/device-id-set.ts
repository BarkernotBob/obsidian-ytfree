/**
 * A bounded set of video ids remembered on this device (GitHub #66 G5).
 *
 * Used for "this video has no most-replayed graph": most videos have none, and
 * without a record each would be asked again every session its note is
 * played. Kept on the device, not in the vault, because a "we checked" marker
 * written into a synced note would be noise in the note. The oldest id goes
 * first once `max` is reached. Storage failures are ignored: the set then
 * lasts for this session only.
 */
import type { AnswerStore } from "./info-cache.ts";

export class DeviceIdSet {
  private ids: string[] = [];
  private readonly store: AnswerStore | null;
  private readonly max: number;

  constructor(store: AnswerStore | null, max = 2000) {
    this.store = store;
    this.max = max;
    try {
      const parsed = JSON.parse(store?.read() ?? "[]") as unknown;
      if (Array.isArray(parsed)) this.ids = parsed.filter((id): id is string => typeof id === "string").slice(-max);
    } catch {
      // Unreadable: start empty.
    }
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  add(id: string): void {
    if (this.has(id)) return;
    this.ids.push(id);
    if (this.ids.length > this.max) this.ids.splice(0, this.ids.length - this.max);
    try {
      this.store?.write(JSON.stringify(this.ids));
    } catch {
      // Best effort.
    }
  }
}
