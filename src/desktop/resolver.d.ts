import type { YtDlpInfo } from "../ytdlp-info";
import { isBotCheck } from "../bot-check";
import type { ResolvedStream, ResolveMode } from "../stream";
export { isBotCheck };
export declare function findYtDlp(configuredPath: string): Promise<string>;
export declare function getVersion(ytDlpPath: string): Promise<string>;
export declare function fetchYtDlpInfo(videoId: string, ytDlpPath: string): Promise<YtDlpInfo>;
export declare function resolveStream(videoId: string, ytDlpPath: string, mode: ResolveMode): Promise<ResolvedStream>;
