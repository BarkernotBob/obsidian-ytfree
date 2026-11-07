/**
 * A silent WAV, for keeping a paused background session alive on iOS.
 *
 * iOS suspends Obsidian a few seconds after its audio stops, and WebKit lets
 * go of the paused video with it, so an AirPods "play" a minute later finds
 * nothing to play. A looping silent clip keeps the audio session open, which
 * keeps the app awake and the lock-screen tile live. Built in code rather
 * than shipped as a file: 44 bytes of header and a second of zeros.
 */

/** Unsigned 8-bit PCM is silent at 128, not 0. */
const SILENCE_8BIT = 128;

/** A mono 8-bit PCM WAV of `seconds` of silence at `sampleRate`. */
export function silentWav(seconds = 1, sampleRate = 8000): Uint8Array<ArrayBuffer> {
  const samples = Math.max(1, Math.round(seconds * sampleRate));
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate = rate × 1 channel × 1 byte
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(SILENCE_8BIT, 44);
  return bytes;
}

/** How long a paused background session is held open before it is let go. */
export const KEEPALIVE_MAX_MS = 60 * 60 * 1000;
