import type { ThresholdChoice } from "../silence";
export declare const CALIBRATION_SECONDS = 60;
export declare const CALIBRATION_WINDOW_SAMPLES = 4800;
export interface CalibrateOptions {
    ffmpegPath: string;
    input: string;
    from?: number;
    seconds?: number;
    floorMargin?: number;
}
export declare function measurePeakLevels(opts: CalibrateOptions): Promise<number[]>;
export declare function calibrateThreshold(opts: CalibrateOptions): Promise<ThresholdChoice>;
