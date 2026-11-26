import type { FetchRange } from "../adaptive";
export declare const IDLE_TIMEOUT_MS = 15000;
export declare const streamingFetchRange: FetchRange;
export declare function streamingWithFallback(fallback: FetchRange, primary?: FetchRange): FetchRange;
