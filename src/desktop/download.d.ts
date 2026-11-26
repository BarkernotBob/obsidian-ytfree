export declare const AGE_LIMIT_PREFIX = "ytfree-age-limit:";
export declare function defaultDownloadFolder(): string;
export declare function ensureDir(dir: string): Promise<void>;
export declare function removeFile(path: string): Promise<void>;
export declare const MIN_FREE_BYTES: number;
export declare const LARGE_FILE_BYTES: number;
export declare function findFfmpeg(configured: string): Promise<string | null>;
export declare function sanitizeFilename(name: string): string;
export declare function downloadBaseName(title: string, videoId: string): string;
export declare function findByVideoId(files: string[], videoId: string): string | null;
export declare function parseProgress(line: string): {
    percent: number;
    totalBytes: number | null;
} | null;
export declare function freeBytes(dir: string): Promise<number | null>;
export declare function formatBytes(bytes: number): string;
export declare function formatSelector(hasFfmpeg: boolean): string;
export interface DownloadOptions {
    videoId: string;
    ytDlpPath: string;
    ffmpegPath: string | null;
    destDir: string;
    baseName: string;
    onProgress: (percent: number, totalBytes: number | null) => void;
}
export interface DownloadHandle {
    done: Promise<string>;
    cancel: () => void;
}
export declare function buildArgs(opts: DownloadOptions): string[];
export declare function downloadVideo(opts: DownloadOptions): DownloadHandle;
export declare function sweepPartials(dir: string, baseName: string): Promise<void>;
export declare function resolveLocalFile(recordedPath: string, destDir: string, videoId: string): Promise<string | null>;
export declare function localFileUrl(absolutePath: string): string;
