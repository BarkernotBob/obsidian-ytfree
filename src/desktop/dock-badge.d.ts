export declare const BADGE_TEXT = "\u25B6";
export declare const SWEEP_MS = 2000;
export interface AudibleSource {
    isDestroyed(): boolean;
    isCurrentlyAudible(): boolean;
}
export interface DockLike {
    setBadge(text: string): void;
    getBadge?(): string;
}
export interface BadgeEnv {
    dock: DockLike;
    allSources(): AudibleSource[];
}
export declare function anyAudible(sources: AudibleSource[]): boolean;
export declare class DockAudioBadge {
    private shown;
    private readonly env;
    constructor(env: BadgeEnv);
    refresh(): void;
    adopt(): void;
    clear(): void;
}
export interface DockBadgeHandle {
    refresh(): void;
    dispose(): void;
}
export declare function readDockBadge(): string | null;
export declare function readAudible(): boolean | null;
export declare function diagnoseDockBadge(): Record<string, unknown>;
export declare function createDockAudioBadge(): DockBadgeHandle | null;
