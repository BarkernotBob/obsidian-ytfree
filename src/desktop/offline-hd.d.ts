import type { FetchRange } from "../adaptive";
import type { OfflineManifest } from "../offline-hd";
export declare function loadOfflineManifest(folder: string): Promise<OfflineManifest>;
export declare function offlineFetchRange(folder: string): FetchRange;
