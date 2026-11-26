import type { SilenceWindow } from "../silence";
export interface SilenceDetectOptions {
    ffmpegPath: string;
    input: string;
    noiseDb: number;
    minGap: number;
    from?: number;
    to?: number;
    onWindows: (windows: SilenceWindow[]) => void;
}
export interface SilenceDetectHandle {
    cancel: () => void;
    done: Promise<void>;
}
export declare function detectSilence(opts: SilenceDetectOptions): SilenceDetectHandle;
export declare const SILENCE_WORKERS = 6;
export declare const SILENCE_CHUNK_SECONDS = 60;
export declare const SILENCE_CHUNK_OVERLAP = 3;
export interface ChunkedSilenceOptions extends Omit<SilenceDetectOptions, "from" | "to"> {
    duration: number;
    playheadSeconds: number;
    analyzedTo?: number;
    workers?: number;
    onProgress?: (frontierSeconds: number, totalSeconds: number) => void;
}
export declare function detectSilenceChunked(opts: ChunkedSilenceOptions): SilenceDetectHandle;
